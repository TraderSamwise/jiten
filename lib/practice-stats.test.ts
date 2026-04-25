import { describe, test, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { createTestDb } from "@/test/test-db";
import {
  getEntryPracticeStats,
  getLeechCards,
  getDailyActivity,
  getRecentSessions,
  getTopConfusionPairs,
  getCardStateDistribution,
  getTodaySummary,
  getCurrentStreak,
  getDayReviewEvents,
  buildConfusionClusters,
} from "./practice-stats";
import type { WrappedUserDb } from "@/db/user-db";

let db: WrappedUserDb & { close: () => void };

beforeEach(() => {
  if (db) db.close();
  db = createTestDb();
});

afterAll(() => {
  if (db) db.close();
});

// ─── Helpers ───

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

async function createList(id: string, name: string) {
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
    [id, name, now, now],
  );
}

async function addListEntry(listId: string, entryId: number) {
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO list_entries (id, list_id, entry_id, added_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [generateId(), listId, entryId, now, now],
  );
}

async function insertPracticeEvent(
  entryId: number,
  correct: boolean,
  reviewedAt: string,
  opts: {
    listId?: string;
    practiceMode?: string;
    responseMs?: number;
    sessionId?: string;
    kanjiLiteral?: string;
  } = {},
) {
  await db.runAsync(
    `INSERT INTO practice_events (id, entry_id, kanji_literal, list_id, practice_mode, correct, assisted, response_ms, typed_answer, reviewed_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
    [
      generateId(),
      entryId,
      opts.kanjiLiteral ?? null,
      opts.listId ?? null,
      opts.practiceMode ?? "flashcard",
      correct ? 1 : 0,
      opts.responseMs ?? null,
      reviewedAt,
      opts.sessionId ?? null,
    ],
  );
}

async function insertSession(
  sessionId: string,
  listId: string,
  startedAt: string,
  opts: { durationMs?: number; totalItems?: number; correctCount?: number } = {},
) {
  await db.runAsync(
    `INSERT INTO practice_sessions (id, session_id, list_id, practice_mode, started_at, duration_ms, total_items, correct_count)
     VALUES (?, ?, ?, 'flashcard', ?, ?, ?, ?)`,
    [
      generateId(),
      sessionId,
      listId,
      startedAt,
      opts.durationMs ?? 60000,
      opts.totalItems ?? 20,
      opts.correctCount ?? 15,
    ],
  );
}

// ─── getEntryPracticeStats ───

describe("getEntryPracticeStats", () => {
  test("returns zero stats when no events exist", async () => {
    const stats = await getEntryPracticeStats(db, 1001);
    expect(stats.total).toBe(0);
    expect(stats.accuracy).toBe(0);
    expect(stats.lastPracticed).toBeNull();
  });

  test("calculates accuracy from practice events", async () => {
    const now = new Date().toISOString();
    await insertPracticeEvent(1001, true, now);
    await insertPracticeEvent(1001, true, now);
    await insertPracticeEvent(1001, false, now);

    const stats = await getEntryPracticeStats(db, 1001);
    expect(stats.total).toBe(3);
    expect(stats.correct).toBe(2);
    expect(stats.accuracy).toBeCloseTo(2 / 3, 5);
  });

  test("only counts events for the specified entry", async () => {
    const now = new Date().toISOString();
    await insertPracticeEvent(1001, true, now);
    await insertPracticeEvent(1002, false, now);

    const stats = await getEntryPracticeStats(db, 1001);
    expect(stats.total).toBe(1);
    expect(stats.correct).toBe(1);
  });
});

// ─── getLeechCards ───

describe("getLeechCards", () => {
  test("returns empty when no practice events", async () => {
    const leeches = await getLeechCards(db, "list-1");
    expect(leeches).toEqual([]);
  });

  test("identifies entries with low accuracy and enough attempts", async () => {
    const now = new Date().toISOString();
    // 12 attempts, 3 correct = 25% accuracy
    for (let i = 0; i < 12; i++) {
      await insertPracticeEvent(1001, i < 3, now, { listId: "list-1" });
    }

    const leeches = await getLeechCards(db, "list-1", 10, 0.5);
    expect(leeches).toHaveLength(1);
    expect(leeches[0].entryId).toBe(1001);
    expect(leeches[0].accuracy).toBeCloseTo(0.25, 2);
  });

  test("excludes entries below min attempts threshold", async () => {
    const now = new Date().toISOString();
    // Only 5 attempts (below default minAttempts=10)
    for (let i = 0; i < 5; i++) {
      await insertPracticeEvent(1001, false, now, { listId: "list-1" });
    }

    const leeches = await getLeechCards(db, "list-1");
    expect(leeches).toEqual([]);
  });
});

// ─── getDailyActivity ───

describe("getDailyActivity", () => {
  test("returns empty when no events", async () => {
    const activity = await getDailyActivity(db);
    expect(activity).toEqual([]);
  });

  test("groups events by day", async () => {
    // Use today and yesterday so they fall within the date('now', ...) window
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    await insertPracticeEvent(1001, true, today.toISOString(), { responseMs: 1000 });
    await insertPracticeEvent(1002, false, today.toISOString(), { responseMs: 2000 });
    await insertPracticeEvent(1003, true, yesterday.toISOString(), { responseMs: 500 });

    const activity = await getDailyActivity(db, null, 90);
    expect(activity).toHaveLength(2);

    const todayStr = today.toISOString().slice(0, 10);
    const todayActivity = activity.find((d) => d.day === todayStr);
    expect(todayActivity).toBeTruthy();
    expect(todayActivity!.reviews).toBe(2);
    expect(todayActivity!.correct).toBe(1);
    expect(todayActivity!.timeMs).toBe(3000);
  });

  test("filters by listId", async () => {
    const now = new Date().toISOString();
    await insertPracticeEvent(1001, true, now, { listId: "list-1" });
    await insertPracticeEvent(1002, true, now, { listId: "list-2" });

    const activity = await getDailyActivity(db, "list-1", 90);
    expect(activity).toHaveLength(1);
    expect(activity[0].reviews).toBe(1);
  });
});

// ─── getRecentSessions ───

describe("getRecentSessions", () => {
  test("returns empty when no sessions", async () => {
    const sessions = await getRecentSessions(db);
    expect(sessions).toEqual([]);
  });

  test("returns sessions ordered by started_at DESC", async () => {
    await insertSession("s1", "list-1", "2025-01-01T10:00:00Z");
    await insertSession("s2", "list-1", "2025-01-02T10:00:00Z");

    const sessions = await getRecentSessions(db);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe("s2");
    expect(sessions[1].sessionId).toBe("s1");
  });

  test("filters by listId", async () => {
    await insertSession("s1", "list-1", "2025-01-01T10:00:00Z");
    await insertSession("s2", "list-2", "2025-01-02T10:00:00Z");

    const sessions = await getRecentSessions(db, "list-1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("s1");
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await insertSession(`s${i}`, "list-1", `2025-01-0${i + 1}T10:00:00Z`);
    }

    const sessions = await getRecentSessions(db, null, 3);
    expect(sessions).toHaveLength(3);
  });
});

// ─── getTopConfusionPairs ───

describe("getTopConfusionPairs", () => {
  test("returns empty when no confusion pairs", async () => {
    const pairs = await getTopConfusionPairs(db);
    expect(pairs).toEqual([]);
  });

  test("returns confusion pairs ordered by count DESC", async () => {
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO confusion_pairs (id, entry_id_a, entry_id_b, confusion_type, confusion_count, last_confused_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["cp1", 1001, 1002, "reading", 5, now, now],
    );
    await db.runAsync(
      `INSERT INTO confusion_pairs (id, entry_id_a, entry_id_b, confusion_type, confusion_count, last_confused_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["cp2", 1003, 1004, "meaning", 10, now, now],
    );

    const pairs = await getTopConfusionPairs(db);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].confusionCount).toBe(10);
    expect(pairs[1].confusionCount).toBe(5);
  });

  test("excludes soft-deleted pairs", async () => {
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO confusion_pairs (id, entry_id_a, entry_id_b, confusion_type, confusion_count, last_confused_at, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["cp1", 1001, 1002, "reading", 5, now, now, now],
    );

    const pairs = await getTopConfusionPairs(db);
    expect(pairs).toEqual([]);
  });
});

// ─── getCardStateDistribution ───

describe("getCardStateDistribution", () => {
  test("returns all zeros for empty list", async () => {
    await createList("list-1", "Test List");

    const dist = await getCardStateDistribution(db, "list-1");
    expect(dist).toMatchObject({
      newCount: 0,
      learning: 0,
      review: 0,
      relearning: 0,
      total: 0,
    });
  });

  test("calculates distribution correctly", async () => {
    await createList("list-1", "Test List");
    // Add 5 list entries
    for (let i = 1; i <= 5; i++) {
      await addListEntry("list-1", i);
    }
    // Add SRS cards for 3 of them (include all NOT NULL columns)
    const now = new Date().toISOString();
    const srsInsert =
      "INSERT INTO srs_cards (id, list_id, entry_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, front_mode, back_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kanji', 'english', ?, ?)";
    await db.runAsync(srsInsert, [
      generateId(),
      "list-1",
      1,
      1,
      now,
      1.0,
      5.0,
      0,
      1,
      1,
      0,
      now,
      now,
    ]); // learning
    await db.runAsync(srsInsert, [
      generateId(),
      "list-1",
      2,
      2,
      now,
      10.0,
      5.0,
      5,
      10,
      5,
      0,
      now,
      now,
    ]); // review
    await db.runAsync(srsInsert, [
      generateId(),
      "list-1",
      3,
      2,
      now,
      10.0,
      5.0,
      5,
      10,
      5,
      0,
      now,
      now,
    ]); // review

    const dist = await getCardStateDistribution(db, "list-1");
    expect(dist.total).toBe(5);
    expect(dist.newCount).toBe(2); // 5 entries - 3 with SRS cards
    expect(dist.learning).toBe(1);
    expect(dist.review).toBe(2);
    expect(dist.relearning).toBe(0);
  });

  test("uses simple stage counts for simple srs lists", async () => {
    await createList("list-1", "Test List");
    for (let i = 1; i <= 5; i++) {
      await addListEntry("list-1", i);
    }

    const now = new Date().toISOString();
    const srsInsert =
      "INSERT INTO srs_cards (id, list_id, entry_id, state, simple_stage, simple_n, simple_interval, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, front_mode, back_mode, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'kanji', 'english', ?, ?)";
    await db.runAsync(srsInsert, [generateId(), "list-1", 1, 0, 0, 1, now, now, now]);
    await db.runAsync(srsInsert, [generateId(), "list-1", 2, 0, 0, 1, now, now, now]);
    await db.runAsync(srsInsert, [generateId(), "list-1", 3, 1, 4, 6, now, now, now]);

    const dist = await getCardStateDistribution(db, "list-1", "simple_srs");
    expect(dist.total).toBe(5);
    expect(dist.newCount).toBe(2);
    expect(dist.learning).toBe(2);
    expect(dist.review).toBe(1);
    expect(dist.relearning).toBe(0);
  });

  test("uses study position for add-order lists", async () => {
    await createList("list-1", "Test List");
    for (let i = 1; i <= 5; i++) {
      await addListEntry("list-1", i);
    }
    await db.runAsync("UPDATE lists SET study_position = 3 WHERE id = ?", ["list-1"]);

    const dist = await getCardStateDistribution(db, "list-1", "add_order");
    expect(dist.total).toBe(5);
    expect(dist.newCount).toBe(2);
    expect(dist.learning).toBe(0);
    expect(dist.review).toBe(3);
    expect(dist.relearning).toBe(0);
  });
});

// ─── getTodaySummary ───

describe("getTodaySummary", () => {
  test("returns zero stats when no events today", async () => {
    const summary = await getTodaySummary(db);
    expect(summary).toMatchObject({
      reviews: 0,
      correct: 0,
      accuracy: 0,
      timeMs: 0,
      sessions: 0,
    });
  });

  test("counts today's events", async () => {
    const now = new Date().toISOString();
    await insertPracticeEvent(1001, true, now, { responseMs: 1000 });
    await insertPracticeEvent(1002, false, now, { responseMs: 2000 });

    const summary = await getTodaySummary(db, null, 0);
    expect(summary.reviews).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.accuracy).toBeCloseTo(0.5, 5);
    expect(summary.timeMs).toBe(3000);
  });
});

// ─── getCurrentStreak ───

describe("getCurrentStreak", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns zero streak when no events", async () => {
    const streak = await getCurrentStreak(db);
    expect(streak).toMatchObject({ current: 0, longest: 0 });
  });

  test("single day of practice gives streak of 1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));

    await insertPracticeEvent(1001, true, "2025-06-15T10:00:00Z");

    const streak = await getCurrentStreak(db, null, 0);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(1);
  });

  test("counts consecutive days including today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));

    await insertPracticeEvent(1001, true, "2025-06-13T12:00:00Z");
    await insertPracticeEvent(1001, true, "2025-06-14T12:00:00Z");
    await insertPracticeEvent(1001, true, "2025-06-15T12:00:00Z");

    const streak = await getCurrentStreak(db, null, 0);
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
  });

  test("streak breaks on gap day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));

    await insertPracticeEvent(1001, true, "2025-06-11T12:00:00Z"); // 4 days ago
    await insertPracticeEvent(1001, true, "2025-06-12T12:00:00Z"); // 3 days ago
    // gap on 2025-06-13
    await insertPracticeEvent(1001, true, "2025-06-14T12:00:00Z"); // yesterday
    await insertPracticeEvent(1001, true, "2025-06-15T12:00:00Z"); // today

    const streak = await getCurrentStreak(db, null, 0);
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
  });

  test("current streak is 0 when last activity was days ago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));

    await insertPracticeEvent(1001, true, "2025-06-01T12:00:00Z");
    await insertPracticeEvent(1001, true, "2025-06-02T12:00:00Z");
    await insertPracticeEvent(1001, true, "2025-06-03T12:00:00Z");

    const streak = await getCurrentStreak(db, null, 0);
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(3);
  });
});

// ─── getDayReviewEvents ───

describe("getDayReviewEvents", () => {
  test("returns events for a specific day", async () => {
    await insertPracticeEvent(1001, true, "2025-01-15T10:00:00Z", { practiceMode: "flashcard" });
    await insertPracticeEvent(1002, false, "2025-01-15T14:00:00Z", { practiceMode: "typing_game" });
    await insertPracticeEvent(1003, true, "2025-01-16T10:00:00Z");

    const events = await getDayReviewEvents(db, "2025-01-15");
    expect(events).toHaveLength(2);
    expect(events[0].entryId).toBe(1001);
    expect(events[1].entryId).toBe(1002);
  });

  test("returns empty for day with no events", async () => {
    const events = await getDayReviewEvents(db, "2025-01-15");
    expect(events).toEqual([]);
  });
});

// ─── buildConfusionClusters (pure function) ───

describe("buildConfusionClusters", () => {
  test("returns empty for no pairs", () => {
    const clusters = buildConfusionClusters([]);
    expect(clusters).toEqual([]);
  });

  test("groups connected pairs into clusters", () => {
    const clusters = buildConfusionClusters([
      {
        entryIdA: 1,
        entryIdB: 2,
        kanjiLiteralA: null,
        kanjiLiteralB: null,
        confusionType: "reading",
        confusionCount: 3,
        lastConfusedAt: "2025-01-01",
      },
      {
        entryIdA: 2,
        entryIdB: 3,
        kanjiLiteralA: null,
        kanjiLiteralB: null,
        confusionType: "reading",
        confusionCount: 2,
        lastConfusedAt: "2025-01-01",
      },
      {
        entryIdA: 10,
        entryIdB: 11,
        kanjiLiteralA: null,
        kanjiLiteralB: null,
        confusionType: "meaning",
        confusionCount: 1,
        lastConfusedAt: "2025-01-01",
      },
    ]);

    expect(clusters).toHaveLength(2);
    // Cluster with entries 1,2,3 has total 5
    const bigCluster = clusters.find((c) => c.totalConfusions === 5);
    expect(bigCluster).toBeTruthy();
    expect(bigCluster!.entries).toHaveLength(3);
    expect(bigCluster!.dominantType).toBe("reading");
  });

  test("sorts clusters by total confusions descending", () => {
    const clusters = buildConfusionClusters([
      {
        entryIdA: 1,
        entryIdB: 2,
        kanjiLiteralA: null,
        kanjiLiteralB: null,
        confusionType: "reading",
        confusionCount: 1,
        lastConfusedAt: "2025-01-01",
      },
      {
        entryIdA: 10,
        entryIdB: 11,
        kanjiLiteralA: null,
        kanjiLiteralB: null,
        confusionType: "meaning",
        confusionCount: 10,
        lastConfusedAt: "2025-01-01",
      },
    ]);

    expect(clusters[0].totalConfusions).toBe(10);
    expect(clusters[1].totalConfusions).toBe(1);
  });
});
