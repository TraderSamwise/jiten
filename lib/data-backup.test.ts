import Database from "better-sqlite3";
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

  it("continues importing later tables after a per-table failure and reports progress", async () => {
    const sourceDb = createTestDb();
    const targetDb = createTestDb();
    const now = "2026-04-05T00:00:00.000Z";
    const progress: Array<{ percent: number; label: string }> = [];

    try {
      await sourceDb.runAsync(
        `INSERT INTO lists (id, name, is_default, study_position, created_at, updated_at)
         VALUES ('list-1', 'List', 0, 0, ?, ?)`,
        [now, now],
      );
      await sourceDb.runAsync(
        `INSERT INTO confusion_pairs
          (id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, confusion_count, last_confused_at, created_at)
         VALUES ('cp-1', 1001, NULL, 1002, NULL, 'meaning', 2, ?, ?)`,
        [now, now],
      );

      const backup = await attemptBackup(sourceDb);
      const json = JSON.stringify({ version: 1, tables: backup.tables });

      const failingDb = {
        ...targetDb,
        runAsync: async (sql: string, params?: any[]) => {
          if (sql.includes("INSERT OR REPLACE INTO lists")) {
            throw new Error("lists import failed");
          }
          return targetDb.runAsync(sql, params);
        },
      };

      const result = await importBackup(failingDb, json, (percent, label) => {
        progress.push({ percent, label });
      });

      expect(result.failed).toEqual([{ table: "lists", error: "Error: lists import failed" }]);
      expect(result.succeeded).toContain("confusion_pairs");
      expect(result.totalRows).toBe(1);
      expect(progress.at(0)).toEqual({ percent: 0, label: "Importing lists..." });
      expect(progress.at(-1)).toEqual({ percent: 100, label: "Done" });

      const importedPair = await targetDb.getFirstAsync<{ id: string }>(
        "SELECT id FROM confusion_pairs WHERE id = ?",
        ["cp-1"],
      );
      expect(importedPair?.id).toBe("cp-1");
    } finally {
      sourceDb.close();
      targetDb.close();
    }
  });
});

/**
 * A schema change must not cost the user their data in either direction.
 *
 * Review proved both halves broke: a backup from a build with
 * `new_per_session` restored onto one without it failed per TABLE, so every
 * list and every flashcard was skipped; and `attemptBackup`'s SELECT names the
 * new columns while the recovery screen only runs when the database failed to
 * migrate — precisely when they may not exist.
 */
describe("backup across a schema change", () => {
  /** A `WrappedUserDb`-shaped wrapper over better-sqlite3. */
  function wrap(db: Database.Database) {
    return {
      getAllAsync: async <T>(sql: string, args: unknown[] = []) =>
        db.prepare(sql).all(...(args as unknown[])) as T[],
      getFirstAsync: async <T>(sql: string, args: unknown[] = []) =>
        (db.prepare(sql).get(...(args as unknown[])) ?? null) as T | null,
      runAsync: async (sql: string, args: unknown[] = []) => {
        db.prepare(sql).run(...(args as unknown[]));
      },
      execAsync: async (sql: string) => {
        db.exec(sql);
      },
    } as unknown as Parameters<typeof importBackup>[0];
  }

  /** The `lists` table as it was before `new_per_session` existed. */
  function olderDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE lists (
      id TEXT PRIMARY KEY, name TEXT, description TEXT,
      flashcard_mode TEXT DEFAULT 'add_order', front_faces TEXT, back_faces TEXT,
      study_position INTEGER DEFAULT 0, configured INTEGER DEFAULT 0,
      auto_play_audio INTEGER DEFAULT 0, confusion_detection INTEGER DEFAULT 1,
      voice_mode INTEGER DEFAULT 0, typing_mode INTEGER DEFAULT 0,
      disable_flip_animation INTEGER DEFAULT 0, disable_swipe_animation INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0, learning_steps TEXT, relearning_steps TEXT,
      mnemonic_cloze INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`);
    return db;
  }

  it("restores onto an older build instead of losing every list", async () => {
    const db = olderDb();
    const backup = JSON.stringify({
      version: 1,
      tables: {
        lists: [
          { id: "l1", name: "Core 8k", new_per_session: 25, created_at: "x", updated_at: "y" },
        ],
      },
    });
    const result = await importBackup(wrap(db), backup);
    expect(result.failed).toEqual([]);
    expect(result.succeeded).toContain("lists");
    expect(db.prepare("SELECT name FROM lists WHERE id = 'l1'").get()).toEqual({ name: "Core 8k" });
  });

  it("takes the column default for a column an older backup never had", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT,
      new_per_session INTEGER DEFAULT 10, created_at TEXT, updated_at TEXT)`);
    // No `new_per_session` key at all, the way a pre-feature backup looks.
    const backup = JSON.stringify({
      version: 1,
      tables: { lists: [{ id: "l1", name: "Core 8k", created_at: "x", updated_at: "y" }] },
    });
    await importBackup(wrap(db), backup);
    expect(db.prepare("SELECT new_per_session FROM lists WHERE id = 'l1'").get()).toEqual({
      new_per_session: 10,
    });
  });

  it("rescues the rows a failed migration leaves readable", async () => {
    const db = olderDb();
    db.prepare("INSERT INTO lists (id, name) VALUES ('l1', 'Core 8k')").run();
    // BACKUP_TABLES names `new_per_session`, which this database lacks.
    const result = await attemptBackup(wrap(db) as never);
    expect(result.failed).not.toContain("lists");
    expect(result.tables.lists).toHaveLength(1);
    expect((result.tables.lists[0] as { name: string }).name).toBe("Core 8k");
  });
});
