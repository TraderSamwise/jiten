/**
 * Build script: Downloads JMdict (English) and Kanjium pitch accent data,
 * processes them, and outputs a SQLite database ready for the app.
 *
 * Usage: npx tsx scripts/build-dictionary.ts
 *
 * Output: assets/dictionary.db
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { toRomaji } from "wanakana";
import WordNet from "node-wordnet";
import wordnetDb from "wordnet-db";
import { buildKanjiTables } from "./kanji/build-kanji-tables";
import { buildAudioTable } from "./audio/build-audio-table";
import { DICT_VERSION } from "../db/dict-version";

const KANJIUM_URL =
  "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt";

async function getJmdictUrl(): Promise<string> {
  console.log("  Resolving latest jmdict-simplified release...");
  const res = await fetch(
    "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest",
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const release = (await res.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find(
    (a) =>
      a.name.startsWith("jmdict-eng-") &&
      a.name.endsWith(".json.tgz") &&
      !a.name.includes("common"),
  );
  if (!asset) throw new Error("Could not find jmdict-eng tgz in latest release");
  console.log(`  Found: ${asset.name}`);
  return asset.browser_download_url;
}

const OUT_DIR = path.resolve(__dirname, "..", "assets");
const DB_PATH = path.join(OUT_DIR, "dictionary.db");
const CACHE_DIR = path.resolve(__dirname, "..", ".cache");

interface JMdictWord {
  id: string;
  kanji: { text: string; common: boolean; tags: string[] }[];
  kana: {
    text: string;
    common: boolean;
    tags: string[];
    appliesToKanji: string[];
  }[];
  sense: {
    partOfSpeech: string[];
    appliesToKanji: string[];
    appliesToKana: string[];
    related: string[][];
    antonym: string[][];
    field: string[];
    dialect: string[];
    misc: string[];
    info: string[];
    languageSource: unknown[];
    gloss: { lang: string; text: string; gender?: string; type?: string }[];
  }[];
}

interface JMdictData {
  version: string;
  languages: string[];
  commonOnly: boolean;
  dictDate: string;
  dictRevisions: string[];
  tags: Record<string, string>;
  words: JMdictWord[];
}

async function downloadFile(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  Using cached: ${path.basename(dest)}`);
    return;
  }
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}

async function extractTgz(tgzPath: string, outDir: string): Promise<string> {
  console.log("  Extracting tgz...");
  const { execSync } = await import("child_process");
  fs.mkdirSync(outDir, { recursive: true });
  execSync(`tar -xzf "${tgzPath}" -C "${outDir}"`, { stdio: "inherit" });
  // Find the extracted .json file
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".json") && f.startsWith("jmdict-eng"));
  if (files.length === 0) throw new Error("No jmdict JSON found after extraction");
  return path.join(outDir, files[0]);
}

function computePriority(word: JMdictWord): number {
  // jmdict-simplified strips frequency tags (ichi1, news1, nf01, etc.)
  // and only exposes a boolean `common` flag. We approximate priority using
  // common status + shortest form length (shorter common words are more basic).
  const isCommon = word.kanji.some((k) => k.common) || word.kana.some((k) => k.common);
  if (!isCommon) return 0;

  // Shortest kanji or kana form length (1-char kanji = highest priority)
  const lengths = [
    ...word.kanji.filter((k) => k.common).map((k) => k.text.length),
    ...word.kana.filter((k) => k.common).map((k) => k.text.length),
  ];
  const minLen = Math.min(...lengths, 20);

  // Common words get 50 base + length bonus (shorter = higher)
  // 1 char → +30, 2 chars → +20, 3 chars → +15, 4+ chars → diminishing
  const lengthBonus = Math.max(0, Math.round(30 / minLen));
  return 50 + lengthBonus;
}

function loadPitchAccents(
  filePath: string,
): Map<string, { reading: string; pitchNumber: number }[]> {
  const map = new Map<string, { reading: string; pitchNumber: number }[]>();
  if (!fs.existsSync(filePath)) return map;

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const parts = line.trim().split("\t");
    if (parts.length < 3) continue;
    const [word, reading, pitchStr] = parts;
    const pitchNumbers = pitchStr.split(",").map(Number).filter(Number.isFinite);
    for (const pitchNumber of pitchNumbers) {
      const key = word || reading;
      const existing = map.get(key) ?? [];
      existing.push({ reading: reading || word, pitchNumber });
      map.set(key, existing);
    }
  }
  return map;
}

async function main() {
  console.log("Building dictionary database...\n");

  // Ensure directories exist
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Download data
  console.log("1. Downloading JMdict...");
  const tgzPath = path.join(CACHE_DIR, "jmdict-eng.json.tgz");
  if (fs.existsSync(tgzPath)) {
    console.log(`  Using cached: ${path.basename(tgzPath)}`);
  } else {
    const jmdictUrl = await getJmdictUrl();
    await downloadFile(jmdictUrl, tgzPath);
  }

  const jsonPath = await extractTgz(tgzPath, CACHE_DIR);

  console.log("2. Downloading Kanjium pitch accent data...");
  const pitchPath = path.join(CACHE_DIR, "accents.txt");
  await downloadFile(KANJIUM_URL, pitchPath);

  // Load data
  console.log("\n3. Loading JMdict JSON...");
  const jmdict: JMdictData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`   ${jmdict.words.length} entries loaded`);

  console.log("4. Loading pitch accent data...");
  const pitchMap = loadPitchAccents(pitchPath);
  console.log(`   ${pitchMap.size} words with pitch data`);

  // Build SQLite database
  console.log("\n5. Building SQLite database...");
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      common INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE kanji (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      text TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );

    CREATE TABLE kana (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      text TEXT NOT NULL,
      romaji TEXT,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );

    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      part_of_speech TEXT,
      glosses TEXT NOT NULL,
      field TEXT,
      misc TEXT,
      info TEXT
    );

    CREATE TABLE pitch_accents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      reading TEXT NOT NULL,
      pitch_number INTEGER NOT NULL
    );
  `);

  // Prepare statements
  const insertEntry = db.prepare("INSERT INTO entries (id, common, priority) VALUES (?, ?, ?)");
  const insertKanji = db.prepare(
    "INSERT INTO kanji (entry_id, text, common, tags) VALUES (?, ?, ?, ?)",
  );
  const insertKana = db.prepare(
    "INSERT INTO kana (entry_id, text, romaji, common, tags) VALUES (?, ?, ?, ?, ?)",
  );
  const insertSense = db.prepare(
    "INSERT INTO senses (entry_id, part_of_speech, glosses, field, misc, info) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertPitch = db.prepare(
    "INSERT INTO pitch_accents (entry_id, reading, pitch_number) VALUES (?, ?, ?)",
  );

  // Insert all entries in a transaction
  let entryCount = 0;
  let pitchMatches = 0;

  const insertAll = db.transaction(() => {
    for (const word of jmdict.words) {
      const entryId = parseInt(word.id, 10);
      const isCommon = word.kanji.some((k) => k.common) || word.kana.some((k) => k.common);
      const priority = computePriority(word);

      insertEntry.run(entryId, isCommon ? 1 : 0, priority);

      for (const k of word.kanji) {
        const tags = k.tags.length > 0 ? JSON.stringify(k.tags) : null;
        insertKanji.run(entryId, k.text, k.common ? 1 : 0, tags);
      }

      for (const k of word.kana) {
        const romaji = toRomaji(k.text);
        const tags = k.tags.length > 0 ? JSON.stringify(k.tags) : null;
        insertKana.run(entryId, k.text, romaji, k.common ? 1 : 0, tags);
      }

      for (const s of word.sense) {
        const glosses = JSON.stringify(s.gloss.map((g) => ({ lang: g.lang, text: g.text })));
        insertSense.run(
          entryId,
          s.partOfSpeech.length > 0 ? JSON.stringify(s.partOfSpeech) : null,
          glosses,
          s.field.length > 0 ? s.field.join(", ") : null,
          s.misc.length > 0 ? s.misc.join(", ") : null,
          s.info.length > 0 ? s.info.join("; ") : null,
        );
      }

      // Match pitch accent data
      const lookupKeys = [...word.kanji.map((k) => k.text), ...word.kana.map((k) => k.text)];
      const addedPitches = new Set<string>();
      for (const key of lookupKeys) {
        const accents = pitchMap.get(key);
        if (accents) {
          for (const a of accents) {
            const pitchKey = `${a.reading}-${a.pitchNumber}`;
            if (!addedPitches.has(pitchKey)) {
              insertPitch.run(entryId, a.reading, a.pitchNumber);
              addedPitches.add(pitchKey);
            }
          }
          pitchMatches++;
        }
      }

      entryCount++;
      if (entryCount % 50000 === 0) {
        console.log(`   ${entryCount} entries processed...`);
      }
    }
  });

  insertAll();
  console.log(`   ${entryCount} entries inserted`);
  console.log(`   ${pitchMatches} entries matched with pitch accent data`);

  // Create indexes
  console.log("\n6. Creating indexes...");
  db.exec(`
    CREATE INDEX idx_kanji_entry ON kanji(entry_id);
    CREATE INDEX idx_kanji_text ON kanji(text);
    CREATE INDEX idx_kana_entry ON kana(entry_id);
    CREATE INDEX idx_kana_text ON kana(text);
    CREATE INDEX idx_kana_romaji ON kana(romaji);
    CREATE INDEX idx_senses_entry ON senses(entry_id);
    CREATE INDEX idx_pitch_entry ON pitch_accents(entry_id);
    CREATE INDEX idx_entries_common ON entries(common);
    CREATE INDEX idx_entries_priority ON entries(priority);
  `);

  // Create FTS5 table for English gloss search
  console.log("7. Building FTS index for English glosses...");
  db.exec(`
    CREATE VIRTUAL TABLE glosses_fts USING fts5(
      glosses,
      entry_id UNINDEXED,
      tokenize='porter unicode61'
    );

    INSERT INTO glosses_fts (glosses, entry_id)
    SELECT
      GROUP_CONCAT(json_extract(j.value, '$.text'), ' '),
      s.entry_id
    FROM senses s, json_each(s.glosses) j
    WHERE json_extract(j.value, '$.lang') = 'eng'
    GROUP BY s.entry_id;
  `);

  // Build synonym table from WordNet
  console.log("\n8. Building synonym table from WordNet...");

  // Step 1: Extract gloss vocabulary — all unique content words from English glosses
  const glossRows = db.prepare(`SELECT glosses FROM senses`).all() as { glosses: string }[];

  const glossVocab = new Set<string>();
  const wordPattern = /[a-z]{3,}/g; // only words 3+ chars
  for (const row of glossRows) {
    try {
      const glosses = JSON.parse(row.glosses) as { lang: string; text: string }[];
      for (const g of glosses) {
        if (g.lang !== "eng") continue;
        const words = g.text.toLowerCase().match(wordPattern);
        if (words) {
          for (const w of words) glossVocab.add(w);
        }
      }
    } catch {}
  }
  console.log(`   ${glossVocab.size} unique vocabulary words extracted from glosses`);

  // Step 2: Look up WordNet relationships for each vocabulary word
  db.exec(`
    CREATE TABLE synonyms (
      word TEXT NOT NULL,
      synonym TEXT NOT NULL
    );
  `);

  const insertSynonym = db.prepare("INSERT INTO synonyms (word, synonym) VALUES (?, ?)");

  const wn = new WordNet(wordnetDb.path);
  const RELATED_PTRS = new Set(["+", "&", "~"]); // derivational, similar-to, hyponym
  let synCount = 0;
  let wordsDone = 0;
  const vocabArray = [...glossVocab];

  const insertSynonyms = db.transaction((pairs: { word: string; synonym: string }[]) => {
    for (const p of pairs) {
      insertSynonym.run(p.word, p.synonym);
    }
  });

  // Process in batches for memory/performance
  const BATCH_SIZE = 500;
  for (let i = 0; i < vocabArray.length; i += BATCH_SIZE) {
    const batch = vocabArray.slice(i, i + BATCH_SIZE);
    const pairs: { word: string; synonym: string }[] = [];

    await Promise.all(
      batch.map(async (word) => {
        try {
          const results = await wn.lookupAsync(word);
          const synonyms = new Set<string>();

          for (const result of results) {
            // Direct synset synonyms
            for (const syn of result.synonyms) {
              const normalized = syn.toLowerCase().replace(/_/g, " ");
              if (
                !normalized.includes(" ") &&
                normalized.length >= 3 &&
                glossVocab.has(normalized) &&
                normalized !== word
              ) {
                synonyms.add(normalized);
              }
            }

            // Related forms: derivational (+), similar-to (&), hyponyms (~)
            for (const ptr of result.ptrs) {
              if (!RELATED_PTRS.has(ptr.pointerSymbol)) continue;
              try {
                const related = await wn.getAsync(ptr.synsetOffset, ptr.pos);
                for (const syn of related.synonyms) {
                  const normalized = syn.toLowerCase().replace(/_/g, " ");
                  if (
                    !normalized.includes(" ") &&
                    normalized.length >= 3 &&
                    glossVocab.has(normalized) &&
                    normalized !== word
                  ) {
                    synonyms.add(normalized);
                  }
                }
              } catch {}
            }
          }

          for (const syn of synonyms) {
            pairs.push({ word, synonym: syn });
          }
        } catch {}
      }),
    );

    insertSynonyms(pairs);
    synCount += pairs.length;
    wordsDone += batch.length;
    if (wordsDone % 5000 === 0 || wordsDone === vocabArray.length) {
      console.log(
        `   ${wordsDone}/${vocabArray.length} words processed, ${synCount} synonym pairs so far...`,
      );
    }
  }

  db.exec(`CREATE INDEX idx_synonyms_word ON synonyms(word);`);
  console.log(`   ${synCount} synonym pairs inserted`);

  // Build kanji index
  await buildKanjiTables(db);

  // Build word audio
  await buildAudioTable(db);

  // Optimize
  console.log("\n19. Optimizing database...");
  db.exec("PRAGMA optimize");
  db.exec("VACUUM");
  db.close();

  const fullStats = fs.statSync(DB_PATH);
  console.log(`\nFull database: ${DB_PATH} (${(fullStats.size / 1024 / 1024).toFixed(1)} MB)`);

  // ─── Split audio into separate DB ───
  console.log("\n20. Splitting audio into separate database...");
  const AUDIO_DB_PATH = path.join(OUT_DIR, "dictionary-audio.db");
  if (fs.existsSync(AUDIO_DB_PATH)) fs.unlinkSync(AUDIO_DB_PATH);

  // Reopen the main DB to extract audio
  const mainDb = new Database(DB_PATH);
  const audioDb = new Database(AUDIO_DB_PATH);
  audioDb.pragma("journal_mode = WAL");

  // Create word_audio table in audio DB
  audioDb.exec(`
    CREATE TABLE word_audio (
      entry_id INTEGER NOT NULL,
      reading TEXT NOT NULL,
      audio BLOB NOT NULL,
      source TEXT NOT NULL,
      format TEXT NOT NULL,
      PRIMARY KEY (entry_id, reading)
    );
  `);

  // Copy all rows from main DB's word_audio into audio DB
  const audioRows = mainDb
    .prepare("SELECT entry_id, reading, audio, source, format FROM word_audio")
    .all() as {
    entry_id: number;
    reading: string;
    audio: Buffer;
    source: string;
    format: string;
  }[];

  const insertAudioRow = audioDb.prepare(
    "INSERT INTO word_audio (entry_id, reading, audio, source, format) VALUES (?, ?, ?, ?, ?)",
  );

  const insertAllAudio = audioDb.transaction(() => {
    for (const row of audioRows) {
      insertAudioRow.run(row.entry_id, row.reading, row.audio, row.source, row.format);
    }
  });
  insertAllAudio();
  console.log(`  ${audioRows.length} audio entries copied to audio DB`);

  // Create index in audio DB
  audioDb.exec("CREATE INDEX idx_word_audio_entry ON word_audio(entry_id)");

  audioDb.exec("VACUUM");
  audioDb.close();

  // Drop word_audio from main DB and re-VACUUM
  mainDb.exec("DROP TABLE word_audio");
  mainDb.exec("VACUUM");
  mainDb.close();

  const coreStats = fs.statSync(DB_PATH);
  const audioStats = fs.statSync(AUDIO_DB_PATH);
  console.log(`  Core DB: ${(coreStats.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Audio DB: ${(audioStats.size / 1024 / 1024).toFixed(1)} MB`);

  // Write manifest JSON for on-demand download
  // DB download URLs are derived at runtime from the manifest URL (sibling files)
  const manifestPath = path.join(OUT_DIR, "dict-manifest.json");
  const manifest = {
    version: DICT_VERSION,
    sizeBytes: coreStats.size,
    audioSizeBytes: audioStats.size,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
