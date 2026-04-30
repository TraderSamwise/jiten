import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/test-db";
import { CLOUD_APPEND_TABLES, LOCAL_APPEND_TABLES, hasLocalData } from "./sync-helpers";

describe("sync helper table contracts", () => {
  it("keeps only practice session summaries in live cloud append sync", () => {
    expect(CLOUD_APPEND_TABLES.map((table) => table.name)).toEqual(["practice_sessions"]);
  });

  it("retains the raw history tables locally", () => {
    expect(LOCAL_APPEND_TABLES.map((table) => table.name)).toEqual([
      "review_logs",
      "practice_events",
      "practice_sessions",
      "confusion_events",
      "game_scores",
    ]);
  });

  it("does not treat default seeded SRS cards as meaningful local data", async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    try {
      await db.runAsync(
        "INSERT INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["default-n5", "JLPT N5 Words", 1, now, now],
      );
      await db.runAsync(
        "INSERT INTO srs_cards (id, list_id, entry_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["c-default", "default-n5", 123, now, 0, 0, 0, 0, 0, 0, 0, now, now],
      );

      await expect(hasLocalData(db)).resolves.toBe(false);
    } finally {
      db.close();
    }
  });

  it("treats non-default SRS cards as meaningful local data", async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    try {
      await db.runAsync(
        "INSERT INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["custom-list", "Custom", 0, now, now],
      );
      await db.runAsync(
        "INSERT INTO srs_cards (id, list_id, entry_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["c-user", "custom-list", 123, now, 0, 0, 0, 0, 0, 0, 0, now, now],
      );

      await expect(hasLocalData(db)).resolves.toBe(true);
    } finally {
      db.close();
    }
  });
});
