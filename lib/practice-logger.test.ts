import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import { getUserDrizzle } from "@/db/drizzle";
import type { UserDrizzle } from "@/db/drizzle";
import { logPracticeEvent, logSessionSummary, recordConfusion } from "./practice-logger";
import type { WrappedUserDb } from "@/db/user-db";

let rawDb: WrappedUserDb & { close: () => void };
let db: UserDrizzle;

beforeEach(() => {
  if (rawDb) rawDb.close();
  rawDb = createTestDb();
  db = getUserDrizzle(rawDb);
});

afterAll(() => {
  if (rawDb) rawDb.close();
});

// ─── logPracticeEvent ───

describe("logPracticeEvent", () => {
  test("inserts a practice event", async () => {
    await logPracticeEvent(db, {
      entryId: 1001,
      practiceMode: "flashcard",
      correct: true,
    });

    const rows = await rawDb.getAllAsync<{ entry_id: number; correct: number }>(
      "SELECT entry_id, correct FROM practice_events",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_id).toBe(1001);
    expect(rows[0].correct).toBe(1);
  });

  test("stores optional fields", async () => {
    await logPracticeEvent(db, {
      entryId: 1001,
      kanjiLiteral: "食",
      listId: "list-1",
      practiceMode: "typing_game",
      correct: false,
      assisted: true,
      responseMs: 1500,
      typedAnswer: "たべる",
      sessionId: "sess-1",
    });

    const row = await rawDb.getFirstAsync<{
      kanji_literal: string;
      list_id: string;
      practice_mode: string;
      assisted: number;
      response_ms: number;
      typed_answer: string;
      session_id: string;
    }>(
      "SELECT kanji_literal, list_id, practice_mode, assisted, response_ms, typed_answer, session_id FROM practice_events",
    );

    expect(row).toMatchObject({
      kanji_literal: "食",
      list_id: "list-1",
      practice_mode: "typing_game",
      assisted: 1,
      response_ms: 1500,
      typed_answer: "たべる",
      session_id: "sess-1",
    });
  });

  test("inserts multiple events", async () => {
    await logPracticeEvent(db, { entryId: 1001, practiceMode: "flashcard", correct: true });
    await logPracticeEvent(db, { entryId: 1002, practiceMode: "flashcard", correct: false });

    const rows = await rawDb.getAllAsync("SELECT * FROM practice_events");
    expect(rows).toHaveLength(2);
  });
});

// ─── logSessionSummary ───

describe("logSessionSummary", () => {
  test("inserts a session summary", async () => {
    await logSessionSummary(db, {
      sessionId: "sess-1",
      listId: "list-1",
      practiceMode: "flashcard",
      startedAt: "2025-01-01T10:00:00Z",
      durationMs: 60000,
      totalItems: 20,
      correctCount: 15,
    });

    const row = await rawDb.getFirstAsync<{
      session_id: string;
      list_id: string;
      total_items: number;
      correct_count: number;
    }>("SELECT session_id, list_id, total_items, correct_count FROM practice_sessions");

    expect(row).toMatchObject({
      session_id: "sess-1",
      list_id: "list-1",
      total_items: 20,
      correct_count: 15,
    });
  });
});

// ─── recordConfusion ───

describe("recordConfusion", () => {
  test("creates a new confusion pair on first occurrence", async () => {
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");

    const row = await rawDb.getFirstAsync<{
      entry_id_a: number;
      entry_id_b: number;
      confusion_type: string;
      confusion_count: number;
    }>("SELECT entry_id_a, entry_id_b, confusion_type, confusion_count FROM confusion_pairs");

    expect(row).toMatchObject({
      entry_id_a: 1001,
      entry_id_b: 1002,
      confusion_type: "reading",
      confusion_count: 1,
    });
  });

  test("increments count on repeated confusion", async () => {
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");

    const row = await rawDb.getFirstAsync<{ confusion_count: number }>(
      "SELECT confusion_count FROM confusion_pairs",
    );
    expect(row?.confusion_count).toBe(3);
  });

  test("orders entry IDs consistently for dedup", async () => {
    // Pass B before A — should still store as A=1001, B=1002
    await recordConfusion(db, { entryId: 1002 }, { entryId: 1001 }, "reading");

    const row = await rawDb.getFirstAsync<{ entry_id_a: number; entry_id_b: number }>(
      "SELECT entry_id_a, entry_id_b FROM confusion_pairs",
    );
    expect(row?.entry_id_a).toBe(1001);
    expect(row?.entry_id_b).toBe(1002);
  });

  test("treats reversed order as same pair (increments)", async () => {
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");
    await recordConfusion(db, { entryId: 1002 }, { entryId: 1001 }, "reading");

    const rows = await rawDb.getAllAsync("SELECT * FROM confusion_pairs");
    expect(rows).toHaveLength(1);

    const row = await rawDb.getFirstAsync<{ confusion_count: number }>(
      "SELECT confusion_count FROM confusion_pairs",
    );
    expect(row?.confusion_count).toBe(2);
  });

  test("also logs a confusion event", async () => {
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "visual_kanji");

    const events = await rawDb.getAllAsync<{ confusion_type: string }>(
      "SELECT confusion_type FROM confusion_events",
    );
    expect(events).toHaveLength(1);
    expect(events[0].confusion_type).toBe("visual_kanji");
  });

  test("handles kanji literal confusion pairs", async () => {
    await recordConfusion(
      db,
      { entryId: 0, kanjiLiteral: "食" },
      { entryId: 0, kanjiLiteral: "飲" },
      "visual_kanji",
    );

    const row = await rawDb.getFirstAsync<{ kanji_literal_a: string; kanji_literal_b: string }>(
      "SELECT kanji_literal_a, kanji_literal_b FROM confusion_pairs",
    );
    // With entryId both 0, ordering is by entryId so a=first arg, b=second arg
    expect(row).toBeTruthy();
    expect(row?.kanji_literal_a).toBeTruthy();
    expect(row?.kanji_literal_b).toBeTruthy();
  });

  test("different confusion types create separate pairs", async () => {
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "reading");
    await recordConfusion(db, { entryId: 1001 }, { entryId: 1002 }, "meaning");

    const rows = await rawDb.getAllAsync("SELECT * FROM confusion_pairs");
    expect(rows).toHaveLength(2);
  });
});
