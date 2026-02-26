/**
 * Patch script: generates TTS for common entries missing audio
 * and inserts them into the existing dictionary-audio.db.
 *
 * Usage: GOOGLE_TTS_API_KEY=... npx tsx scripts/audio/patch-missing-audio.ts
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { generateTts } from "./generate-tts";

const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets");
const DICT_DB_PATH = path.join(ASSETS_DIR, "dictionary.db");
const AUDIO_DB_PATH = path.join(ASSETS_DIR, "dictionary-audio.db");

async function main() {
  const dictDb = new Database(DICT_DB_PATH, { readonly: true });
  const audioDb = new Database(AUDIO_DB_PATH);
  audioDb.pragma("journal_mode = WAL");

  // Find common entries in dict DB that have no audio in audio DB
  const existingIds = new Set(
    (
      audioDb.prepare("SELECT DISTINCT entry_id FROM word_audio").all() as { entry_id: number }[]
    ).map((r) => r.entry_id),
  );

  const allCommon = dictDb
    .prepare(
      `SELECT e.id as entry_id, kn.text as reading
       FROM entries e
       JOIN kana kn ON kn.entry_id = e.id
       WHERE e.common = 1
       GROUP BY e.id`,
    )
    .all() as { entry_id: number; reading: string }[];

  const missing = allCommon.filter((e) => !existingIds.has(e.entry_id));
  console.log(`Found ${missing.length} common entries missing audio`);

  dictDb.close();

  if (missing.length === 0) {
    console.log("Nothing to do!");
    audioDb.close();
    return;
  }

  // Generate TTS
  const results = await generateTts(
    missing.map((e) => ({ entryId: e.entry_id, reading: e.reading })),
  );

  // Insert into audio DB
  const insertAudio = audioDb.prepare(
    "INSERT OR IGNORE INTO word_audio (entry_id, reading, audio, source, format) VALUES (?, ?, ?, ?, ?)",
  );

  let insertCount = 0;
  const insertAll = audioDb.transaction(() => {
    for (const result of results) {
      insertAudio.run(result.entryId, result.reading, result.audioData, "tts", "mp3");
      insertCount++;
    }
  });

  insertAll();
  console.log(`Inserted ${insertCount} new audio entries`);

  const total = audioDb.prepare("SELECT COUNT(*) as cnt FROM word_audio").get() as { cnt: number };
  console.log(`Total audio entries now: ${total.cnt}`);

  audioDb.close();

  // Update manifest with new audio size
  const audioStats = fs.statSync(AUDIO_DB_PATH);
  const manifestPath = path.join(ASSETS_DIR, "dict-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.audioSizeBytes = audioStats.size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `Updated manifest audioSizeBytes: ${audioStats.size} (${(audioStats.size / 1024 / 1024).toFixed(1)} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
