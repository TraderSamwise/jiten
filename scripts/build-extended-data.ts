/**
 * Build script: Generates dictionary-extended.db containing synonyms + names + counter readings.
 *
 * The app downloads this pre-built SQLite DB in the background — no client-side
 * parsing or importing needed.
 *
 * Usage: npx tsx scripts/build-extended-data.ts
 *
 * Output:
 *   assets/dictionary-extended.db
 *   (updates assets/dict-manifest.json with extended data section)
 */

import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import WordNet from "node-wordnet";
import wordnetDb from "wordnet-db";
import { downloadFile, CACHE_DIR, ASSETS_DIR } from "./lib/download";

const DICT_DB_PATH = path.join(ASSETS_DIR, "dictionary.db");
const EXT_DB_PATH = path.join(ASSETS_DIR, "dictionary-extended.db");
const MANIFEST_PATH = path.join(ASSETS_DIR, "dict-manifest.json");
const COUNTER_CSV_PATH = path.resolve(__dirname, "../../jiten-data/counter-readings.csv");

// ─── Schema ───

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS synonyms (
      word TEXT NOT NULL,
      synonym TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS names (
      id INTEGER PRIMARY KEY,
      kanji TEXT,
      kana TEXT NOT NULL,
      name_type TEXT,
      translation TEXT,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS counter_readings (
      counter_id INTEGER NOT NULL,
      counter_kanji TEXT NOT NULL,
      counter_reading TEXT NOT NULL,
      counter_gloss TEXT,
      number TEXT NOT NULL,
      number_kanji TEXT NOT NULL,
      combined_kanji TEXT NOT NULL,
      reading TEXT NOT NULL
    );
  `);
}

function buildIndexes(db: InstanceType<typeof Database>) {
  console.log("  Building indexes...");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_synonyms_word ON synonyms(word)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_synonyms_synonym ON synonyms(synonym)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_names_kanji ON names(kanji)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_names_kana ON names(kana)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_names_category ON names(category)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_ext_counter_reading ON counter_readings(counter_reading)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_counter_kanji ON counter_readings(counter_kanji)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ext_counter_id ON counter_readings(counter_id)");

  // FTS5 index for translation search
  try {
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS names_fts USING fts5(translation, content=names, content_rowid=id)",
    );
    db.exec("INSERT INTO names_fts(names_fts) VALUES('rebuild')");
    console.log("  FTS5 index built");
  } catch (e) {
    console.warn("  FTS5 not available in this SQLite build, skipping:", e);
  }
}

// ─── Synonyms ───

async function insertSynonyms(db: InstanceType<typeof Database>): Promise<number> {
  console.log("\n=== Building synonyms ===\n");

  if (!fs.existsSync(DICT_DB_PATH)) {
    throw new Error(`dictionary.db not found at ${DICT_DB_PATH}. Run yarn migrate:dict first.`);
  }

  const dictDb = new Database(DICT_DB_PATH, { readonly: true });

  // Extract gloss vocabulary — all unique content words from English glosses
  console.log("  Extracting gloss vocabulary...");
  const glossRows = dictDb.prepare(`SELECT glosses FROM senses`).all() as { glosses: string }[];

  const glossVocab = new Set<string>();
  const wordPattern = /[a-z]{3,}/g;
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
  dictDb.close();
  console.log(`  ${glossVocab.size} unique vocabulary words`);

  // Look up WordNet relationships
  console.log("  Looking up WordNet relationships...");
  const wn = new WordNet(wordnetDb.path);
  const RELATED_PTRS = new Set(["+", "&", "~"]); // derivational, similar-to, hyponym
  const pairs: [string, string][] = [];
  let wordsDone = 0;
  const vocabArray = [...glossVocab];

  const BATCH_SIZE = 500;
  for (let i = 0; i < vocabArray.length; i += BATCH_SIZE) {
    const batch = vocabArray.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (word) => {
        try {
          const results = await wn.lookupAsync(word);
          const synonyms = new Set<string>();

          for (const result of results) {
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
            pairs.push([word, syn]);
          }
        } catch {}
      }),
    );

    wordsDone += batch.length;
    if (wordsDone % 5000 === 0 || wordsDone === vocabArray.length) {
      console.log(`  ${wordsDone}/${vocabArray.length} words processed, ${pairs.length} pairs...`);
    }
  }

  console.log(`  ${pairs.length} synonym pairs total`);

  // Bulk insert into DB
  console.log("  Inserting into DB...");
  const insert = db.prepare("INSERT INTO synonyms (word, synonym) VALUES (?, ?)");
  const insertMany = db.transaction((rows: [string, string][]) => {
    for (const row of rows) insert.run(...row);
  });
  insertMany(pairs);

  return pairs.length;
}

// ─── Names (JMnedict) ───

interface JMnedictEntry {
  id: string;
  kanji: { text: string; tags: string[] }[];
  kana: { text: string; tags: string[]; appliesToKanji: string[] }[];
  translation: {
    type: string[];
    related: string[][];
    translation: { lang: string; text: string }[];
  }[];
}

interface JMnedictData {
  version: string;
  dictDate: string;
  words: JMnedictEntry[];
}

async function getJmnedictUrl(): Promise<string> {
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
    (a) => a.name.startsWith("jmnedict-all-") && a.name.endsWith(".json.tgz"),
  );
  if (!asset) throw new Error("Could not find jmnedict-all tgz in latest release");
  console.log(`  Found: ${asset.name}`);
  return asset.browser_download_url;
}

async function insertNames(db: InstanceType<typeof Database>): Promise<number> {
  console.log("\n=== Building names ===\n");

  // Download JMnedict
  const tgzPath = path.join(CACHE_DIR, "jmnedict-all.json.tgz");
  if (!fs.existsSync(tgzPath)) {
    const url = await getJmnedictUrl();
    await downloadFile(url, tgzPath);
  } else {
    console.log(`  Using cached: ${path.basename(tgzPath)}`);
  }

  // Extract
  console.log("  Extracting...");
  const { execSync } = await import("child_process");
  const extractDir = path.join(CACHE_DIR, "jmnedict");
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`tar -xzf "${tgzPath}" -C "${extractDir}"`, { stdio: "inherit" });
  const files = fs
    .readdirSync(extractDir)
    .filter((f) => f.endsWith(".json") && f.startsWith("jmnedict"));
  if (files.length === 0) throw new Error("No jmnedict JSON found after extraction");
  const jsonPath = path.join(extractDir, files[0]);

  // Parse
  console.log("  Parsing JMnedict JSON...");
  const data: JMnedictData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`  ${data.words.length} name entries loaded`);

  // Bulk insert into DB
  console.log("  Inserting into DB...");
  const insert = db.prepare(
    "INSERT OR REPLACE INTO names (id, kanji, kana, name_type, translation, category) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const insertMany = db.transaction((entries: JMnedictEntry[]) => {
    for (const entry of entries) {
      const id = parseInt(entry.id, 10);
      const kanji = entry.kanji.map((k) => k.text);
      const kana = entry.kana.map((k) => k.text);

      const types = new Set<string>();
      const translations: string[] = [];
      for (const tr of entry.translation) {
        for (const t of tr.type) types.add(t);
        for (const tl of tr.translation) {
          if (tl.lang === "eng") translations.push(tl.text);
        }
      }

      const nameType = types.size > 0 ? [...types].join(",") : null;
      let category = "other";
      if (nameType && /\b(surname|fem|masc|given|person)\b/.test(nameType)) {
        category = "person";
      } else if (nameType && /\b(place|station)\b/.test(nameType)) {
        category = "place";
      }

      insert.run(
        id,
        kanji.length > 0 ? kanji.join(", ") : null,
        kana.join(", "),
        nameType,
        translations.length > 0 ? translations.join("; ") : null,
        category,
      );
    }
  });

  insertMany(data.words);
  console.log(`  ${data.words.length} name entries inserted`);

  return data.words.length;
}

// ─── Counter Readings ───

/** Parse a CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function insertCounterReadings(db: InstanceType<typeof Database>): number {
  console.log("\n=== Building counter readings ===\n");

  if (!fs.existsSync(COUNTER_CSV_PATH)) {
    throw new Error(
      `counter-readings.csv not found at ${COUNTER_CSV_PATH}. Clone jiten-data next to jiten.`,
    );
  }

  const csv = fs.readFileSync(COUNTER_CSV_PATH, "utf-8").replace(/\r/g, "");
  const lines = csv.split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const verifiedIdx = header.indexOf("verified_reading");
  const rows = lines.slice(1);

  console.log(`  ${rows.length} readings from CSV`);

  const insert = db.prepare(
    `INSERT INTO counter_readings
      (counter_id, counter_kanji, counter_reading, counter_gloss, number, number_kanji, combined_kanji, reading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((csvRows: string[]) => {
    for (const row of csvRows) {
      const cols = parseCsvLine(row);
      const verifiedReading = cols[verifiedIdx];
      if (!verifiedReading) continue;

      insert.run(
        parseInt(cols[0], 10), // counter_id
        cols[1], // counter_kanji
        cols[2], // counter_reading
        cols[3], // counter_gloss
        cols[4], // number
        cols[5], // number_kanji
        cols[6], // combined_kanji
        verifiedReading,
      );
    }
  });

  insertMany(rows);
  console.log(`  ${rows.length} counter readings inserted`);

  return rows.length;
}

// ─── Main ───

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Remove old files if they exist
  if (fs.existsSync(EXT_DB_PATH)) fs.unlinkSync(EXT_DB_PATH);

  // Create fresh DB
  const db = new Database(EXT_DB_PATH);
  db.pragma("journal_mode = WAL");
  createSchema(db);

  const synonymCount = await insertSynonyms(db);
  const nameCount = await insertNames(db);
  const counterCount = insertCounterReadings(db);

  // Write version metadata
  const version = 2;
  db.prepare("INSERT OR REPLACE INTO ext_meta (key, value) VALUES (?, ?)").run(
    "version",
    String(version),
  );

  // Build indexes
  buildIndexes(db);

  // Optimize
  console.log("\n  Running VACUUM and optimize...");
  db.pragma("journal_mode = DELETE");
  db.exec("VACUUM");
  db.pragma("optimize");
  db.close();

  const dbSize = fs.statSync(EXT_DB_PATH).size;
  console.log(`\n  Written: ${EXT_DB_PATH} (${(dbSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${synonymCount} synonyms, ${nameCount} names, ${counterCount} counter readings`);

  // Update manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`dict-manifest.json not found at ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  manifest.extended = {
    version,
    sizeBytes: dbSize,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
  console.log("\nDone! Run 'yarn publish:dict' to upload.");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
