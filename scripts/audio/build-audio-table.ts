/**
 * Audio build step: generates TTS for all common dictionary entries
 * using Google Cloud TTS (Neural2) and inserts MP3 BLOBs into word_audio.
 *
 * All audio is generated via Google Cloud — no external audio repos.
 * Results are cached in .cache/tts-audio/ so subsequent builds skip
 * already-generated entries (making rebuilds essentially free).
 *
 * Requires GOOGLE_TTS_API_KEY env var. If not set, the audio table
 * is created empty and the build continues without audio.
 *
 * Called from build-dictionary.ts after buildKanjiTables().
 */

import Database from "better-sqlite3";
import { generateTts } from "./generate-tts";

export async function buildAudioTable(db: Database.Database): Promise<void> {
  console.log("\n═══ Building Word Audio ═══\n");

  // Create table
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

  // Find all common entries that need audio
  const commonEntries = db
    .prepare(
      `SELECT e.id as entry_id, kn.text as reading
       FROM entries e
       JOIN kana kn ON kn.entry_id = e.id
       WHERE e.common = 1
       GROUP BY e.id`,
    )
    .all() as { entry_id: number; reading: string }[];

  console.log(`  ${commonEntries.length} common entries to generate audio for`);

  // Generate TTS (skips cached entries automatically)
  const ttsResults = await generateTts(
    commonEntries.map((e) => ({ entryId: e.entry_id, reading: e.reading })),
  );

  // Insert audio into database
  console.log("\n21. Inserting audio into database...");
  const insertAudio = db.prepare(
    "INSERT OR IGNORE INTO word_audio (entry_id, reading, audio, source, format) VALUES (?, ?, ?, ?, ?)",
  );

  let insertCount = 0;
  const insertAll = db.transaction(() => {
    for (const result of ttsResults) {
      insertAudio.run(result.entryId, result.reading, result.audioData, "tts", "mp3");
      insertCount++;
    }
  });

  insertAll();
  console.log(`  ${insertCount} audio entries inserted`);

  // Create index
  db.exec("CREATE INDEX idx_word_audio_entry ON word_audio(entry_id)");

  console.log("\n═══ Word Audio Complete ═══\n");
}
