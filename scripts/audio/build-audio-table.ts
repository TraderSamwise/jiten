/**
 * Audio build orchestrator.
 *
 * Downloads & caches audio sources, matches them to dictionary entries,
 * generates TTS for unmatched common entries, and inserts all audio as
 * MP3 BLOBs into the word_audio table.
 *
 * Called from build-dictionary.ts after buildKanjiTables().
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { matchTofugu } from "./match-tofugu";
import { matchKanjiAlive } from "./match-kanji-alive";
import { generateTts } from "./generate-tts";

const CACHE_DIR = path.resolve(__dirname, "..", "..", ".cache");

// Audio source repos (cloned/downloaded into .cache/)
const TOFUGU_REPO_URL = "https://github.com/tofugu/japanese-vocabulary-pronunciation-audio.git";
const KANJI_ALIVE_REPO_URL = "https://github.com/kanjialive/kanji-data-media.git";

async function cloneOrPullRepo(url: string, destDir: string): Promise<void> {
  const { execSync } = await import("child_process");

  if (fs.existsSync(path.join(destDir, ".git"))) {
    console.log(`  Using cached repo: ${path.basename(destDir)}`);
    return;
  }

  console.log(`  Cloning: ${url}`);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  execSync(`git clone --depth 1 "${url}" "${destDir}"`, {
    stdio: "inherit",
    timeout: 300000, // 5 min timeout
  });
}

export async function buildAudioTable(db: Database.Database): Promise<void> {
  console.log("\n═══ Building Word Audio ═══\n");

  // ─── Step 1: Create table ───
  console.log("20. Creating word_audio table...");
  db.exec(`
    CREATE TABLE word_audio (
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      reading TEXT NOT NULL,
      audio BLOB NOT NULL,
      source TEXT NOT NULL,
      format TEXT NOT NULL,
      PRIMARY KEY (entry_id, reading)
    );
  `);

  // ─── Step 2: Download audio sources ───
  console.log("\n21. Downloading audio sources...");
  const tofuguDir = path.join(CACHE_DIR, "tofugu-audio");
  const kanjiAliveDir = path.join(CACHE_DIR, "kanji-alive-data");

  try {
    await cloneOrPullRepo(TOFUGU_REPO_URL, tofuguDir);
  } catch (err) {
    console.warn(`  Warning: Could not clone Tofugu repo: ${err}`);
  }

  try {
    await cloneOrPullRepo(KANJI_ALIVE_REPO_URL, kanjiAliveDir);
  } catch (err) {
    console.warn(`  Warning: Could not clone Kanji Alive repo: ${err}`);
  }

  // ─── Step 3: Find audio directories ───
  // Tofugu: look for mp3 files in the repo root or an audio/ subdirectory
  const tofuguAudioDir = findAudioDir(tofuguDir);
  // Kanji Alive: audio in kanji-data-media/audio/ or similar
  const kanjiAliveAudioDir = kanjiAliveDir;

  // ─── Step 4: Match Tofugu files (highest priority) ───
  console.log("\n22. Matching Tofugu audio...");
  const tofuguMatches = tofuguAudioDir ? matchTofugu(db, tofuguAudioDir) : [];
  const matchedIds = new Set(tofuguMatches.map((m) => m.entryId));

  // ─── Step 5: Match Kanji Alive files ───
  console.log("\n23. Matching Kanji Alive audio...");
  const kanjiAliveMatches = matchKanjiAlive(db, kanjiAliveAudioDir, matchedIds);
  for (const m of kanjiAliveMatches) matchedIds.add(m.entryId);

  // ─── Step 6: Generate TTS for remaining common entries ───
  console.log("\n24. Generating TTS for unmatched common entries...");
  const commonEntries = db
    .prepare(
      `SELECT e.id as entry_id, kn.text as reading
       FROM entries e
       JOIN kana kn ON kn.entry_id = e.id
       WHERE e.common = 1
       AND e.id NOT IN (${[...matchedIds].join(",") || "0"})
       GROUP BY e.id`,
    )
    .all() as { entry_id: number; reading: string }[];

  console.log(`  ${commonEntries.length} common entries need TTS`);

  const ttsResults = await generateTts(
    commonEntries.map((e) => ({ entryId: e.entry_id, reading: e.reading })),
  );

  // ─── Step 7: Insert all audio into database ───
  console.log("\n25. Inserting audio into database...");
  const insertAudio = db.prepare(
    "INSERT OR IGNORE INTO word_audio (entry_id, reading, audio, source, format) VALUES (?, ?, ?, ?, ?)",
  );

  let insertCount = 0;

  const insertAll = db.transaction(() => {
    // Insert Tofugu matches
    for (const match of tofuguMatches) {
      try {
        const audioData = fs.readFileSync(match.filePath);
        insertAudio.run(match.entryId, match.reading, audioData, "tofugu", "mp3");
        insertCount++;
      } catch (err) {
        // Skip files that can't be read
      }
    }

    // Insert Kanji Alive matches
    for (const match of kanjiAliveMatches) {
      try {
        const audioData = fs.readFileSync(match.filePath);
        insertAudio.run(match.entryId, match.reading, audioData, "kanji_alive", "mp3");
        insertCount++;
      } catch (err) {
        // Skip files that can't be read
      }
    }

    // Insert TTS results
    for (const result of ttsResults) {
      insertAudio.run(result.entryId, result.reading, result.audioData, "tts", "mp3");
      insertCount++;
    }
  });

  insertAll();
  console.log(`  ${insertCount} audio entries inserted`);

  // ─── Step 8: Create index ───
  db.exec("CREATE INDEX idx_word_audio_entry ON word_audio(entry_id)");

  console.log("\n═══ Word Audio Complete ═══\n");
}

/** Find the directory containing .mp3 files in a repo. */
function findAudioDir(repoDir: string): string | null {
  if (!fs.existsSync(repoDir)) return null;

  // Check root
  const rootFiles = fs.readdirSync(repoDir).filter((f) => f.endsWith(".mp3"));
  if (rootFiles.length > 10) return repoDir;

  // Check common subdirectories
  for (const sub of ["audio", "mp3", "sounds", "files"]) {
    const subDir = path.join(repoDir, sub);
    if (fs.existsSync(subDir)) {
      const subFiles = fs.readdirSync(subDir).filter((f) => f.endsWith(".mp3"));
      if (subFiles.length > 0) return subDir;
    }
  }

  // Recursive search (one level deep)
  const entries = fs.readdirSync(repoDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(repoDir, entry.name);
    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".mp3"));
      if (files.length > 10) return dirPath;
    } catch {
      // Permission errors etc
    }
  }

  return null;
}
