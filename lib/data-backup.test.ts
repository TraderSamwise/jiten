import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/test-db";
import { attemptBackup, importBackup } from "./data-backup";

describe("data backup", () => {
  it("round-trips local-only history tables through backup and import", async () => {
    const sourceDb = createTestDb();
    const targetDb = createTestDb();
    const now = "2026-04-05T00:00:00.000Z";

    try {
      await sourceDb.runAsync(
        `INSERT INTO lists (id, name, is_default, study_position, created_at, updated_at)
         VALUES ('list-1', 'List', 0, 0, ?, ?)`,
        [now, now],
      );
      await sourceDb.runAsync(
        `INSERT INTO srs_cards
          (id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, created_at, updated_at)
         VALUES ('card-1', 1001, 'list-1', ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
        [now, now, now],
      );
      await sourceDb.runAsync(
        `INSERT INTO review_logs
          (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
         VALUES ('log-1', 'card-1', 3, 0, ?, 0, 0, 0, 0, ?)`,
        [now, now],
      );
      await sourceDb.runAsync(
        `INSERT INTO practice_events
          (id, entry_id, kanji_literal, list_id, practice_mode, correct, response_ms, typed_answer, reviewed_at, session_id, assisted)
         VALUES ('pe-1', 1001, NULL, 'list-1', 'flashcard', 1, 1500, 'かな', ?, 'session-1', 0)`,
        [now],
      );
      await sourceDb.runAsync(
        `INSERT INTO confusion_pairs
          (id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, confusion_count, last_confused_at, created_at)
         VALUES ('cp-1', 1001, NULL, 1002, NULL, 'meaning', 2, ?, ?)`,
        [now, now],
      );
      await sourceDb.runAsync(
        `INSERT INTO confusion_events
          (id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, list_id, practice_mode, confused_at)
         VALUES ('ce-1', 1001, NULL, 1002, NULL, 'meaning', 'list-1', 'flashcard', ?)`,
        [now],
      );

      const backup = await attemptBackup(sourceDb);
      const json = JSON.stringify({ version: 1, tables: backup.tables });
      const result = await importBackup(targetDb, json);

      expect(result.failed).toEqual([]);

      const reviewLog = await targetDb.getFirstAsync<{ id: string }>(
        "SELECT id FROM review_logs WHERE id = ?",
        ["log-1"],
      );
      const practiceEvent = await targetDb.getFirstAsync<{ typed_answer: string }>(
        "SELECT typed_answer FROM practice_events WHERE id = ?",
        ["pe-1"],
      );
      const confusionPair = await targetDb.getFirstAsync<{ confusion_count: number }>(
        "SELECT confusion_count FROM confusion_pairs WHERE id = ?",
        ["cp-1"],
      );
      const confusionEvent = await targetDb.getFirstAsync<{ confusion_type: string }>(
        "SELECT confusion_type FROM confusion_events WHERE id = ?",
        ["ce-1"],
      );

      expect(reviewLog?.id).toBe("log-1");
      expect(practiceEvent?.typed_answer).toBe("かな");
      expect(confusionPair?.confusion_count).toBe(2);
      expect(confusionEvent?.confusion_type).toBe("meaning");
    } finally {
      sourceDb.close();
      targetDb.close();
    }
  });
});
