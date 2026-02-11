/**
 * Patch script: generates TTS for common entries missing audio
 * and inserts them into the existing dictionary.db.
 *
 * Usage: GOOGLE_TTS_API_KEY=... npx tsx scripts/audio/patch-missing-audio.ts
 */

import Database from "better-sqlite3";
import * as path from "path";
import { generateTts } from "./generate-tts";

const DB_PATH = path.resolve(__dirname, "..", "..", "assets", "dictionary.db");

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Find common entries without audio
  const missing = db
    .prepare(
      `SELECT e.id as entry_id, kn.text as reading
       FROM entries e
       JOIN kana kn ON kn.entry_id = e.id
       WHERE e.common = 1
       AND e.id NOT IN (SELECT entry_id FROM word_audio)
       GROUP BY e.id`,
    )
    .all() as { entry_id: number; reading: string }[];

  console.log(`Found ${missing.length} common entries missing audio`);

  if (missing.length === 0) {
    console.log("Nothing to do!");
    db.close();
    return;
  }

  // Generate TTS
  const results = await generateTts(
    missing.map((e) => ({ entryId: e.entry_id, reading: e.reading })),
  );

  // Insert into DB
  const insertAudio = db.prepare(
    "INSERT OR IGNORE INTO word_audio (entry_id, reading, audio, source, format) VALUES (?, ?, ?, ?, ?)",
  );

  let insertCount = 0;
  const insertAll = db.transaction(() => {
    for (const result of results) {
      insertAudio.run(result.entryId, result.reading, result.audioData, "tts", "mp3");
      insertCount++;
    }
  });

  insertAll();
  console.log(`Inserted ${insertCount} new audio entries`);

  const total = db.prepare("SELECT COUNT(*) as cnt FROM word_audio").get() as { cnt: number };
  console.log(`Total audio entries now: ${total.cnt}`);

  // Update manifest size
  const fs = await import("fs");
  const stats = fs.statSync(DB_PATH);
  const manifestPath = path.resolve(__dirname, "..", "..", "assets", "dict-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.sizeBytes = stats.size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Updated manifest sizeBytes: ${stats.size} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
  );

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
