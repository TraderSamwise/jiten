import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import { getUserDrizzle } from "@/db/drizzle";
import type { UserDrizzle } from "@/db/drizzle";
import {
  markForReview,
  unmarkForReview,
  isMarkedToday,
  getMarkedByDay,
  getMarkedByWeek,
  getMarkedByMonth,
  getMarkedEntryIds,
  cleanupOldMarks,
} from "./review-marks";
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

// ─── markForReview ───

describe("markForReview", () => {
  test("inserts a mark and returns true", async () => {
    const result = await markForReview(db, 1001, null, "list-1", 3);
    expect(result).toBe(true);

    const rows = await rawDb.getAllAsync<{ entry_id: number }>("SELECT entry_id FROM review_marks");
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_id).toBe(1001);
  });

  test("deduplicates same entry on same logical day", async () => {
    await markForReview(db, 1001, null, "list-1", 3);
    const second = await markForReview(db, 1001, null, "list-1", 3);
    expect(second).toBe(false);

    const rows = await rawDb.getAllAsync("SELECT * FROM review_marks");
    expect(rows).toHaveLength(1);
  });

  test("allows same entry on different logical days", async () => {
    // Insert a mark from 2 days ago (UTC) to ensure different logical day
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 2);
    yesterday.setUTCHours(12, 0, 0, 0);
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["old-1", 1001, null, "list-1", yesterday.toISOString()],
    );

    // Today's mark should succeed
    const result = await markForReview(db, 1001, null, "list-1", 3);
    expect(result).toBe(true);

    const rows = await rawDb.getAllAsync("SELECT * FROM review_marks");
    expect(rows).toHaveLength(2);
  });

  test("marks kanji entries separately from word entries", async () => {
    await markForReview(db, 0, "火", "list-1", 3);
    await markForReview(db, 1001, null, "list-1", 3);

    const rows = await rawDb.getAllAsync("SELECT * FROM review_marks");
    expect(rows).toHaveLength(2);
  });

  test("deduplicates kanji marks on same day", async () => {
    await markForReview(db, 0, "火", "list-1", 3);
    const second = await markForReview(db, 0, "火", "list-1", 3);
    expect(second).toBe(false);
  });
});

// ─── unmarkForReview ───

describe("unmarkForReview", () => {
  test("removes today's mark and returns true", async () => {
    await markForReview(db, 1001, null, "list-1", 3);
    const result = await unmarkForReview(db, 1001, null, 3);
    expect(result).toBe(true);
    expect(await isMarkedToday(db, 1001, null, 3)).toBe(false);
  });

  test("returns false when no mark exists", async () => {
    const result = await unmarkForReview(db, 1001, null, 3);
    expect(result).toBe(false);
  });

  test("only removes today's mark, not older ones", async () => {
    // Insert old mark (UTC)
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 2);
    old.setUTCHours(12, 0, 0, 0);
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["old-1", 1001, null, "list-1", old.toISOString()],
    );
    // Insert today's mark
    await markForReview(db, 1001, null, "list-1", 3);

    await unmarkForReview(db, 1001, null, 3);

    const rows = await rawDb.getAllAsync("SELECT * FROM review_marks");
    expect(rows).toHaveLength(1); // old mark remains
  });

  test("handles kanji entries", async () => {
    await markForReview(db, 0, "火", "list-1", 3);
    const result = await unmarkForReview(db, 0, "火", 3);
    expect(result).toBe(true);
    expect(await isMarkedToday(db, 0, "火", 3)).toBe(false);
  });
});

// ─── isMarkedToday ───

describe("isMarkedToday", () => {
  test("returns false when no marks exist", async () => {
    expect(await isMarkedToday(db, 1001, null, 3)).toBe(false);
  });

  test("returns true after marking", async () => {
    await markForReview(db, 1001, null, "list-1", 3);
    expect(await isMarkedToday(db, 1001, null, 3)).toBe(true);
  });

  test("returns false for different entry", async () => {
    await markForReview(db, 1001, null, "list-1", 3);
    expect(await isMarkedToday(db, 2002, null, 3)).toBe(false);
  });

  test("distinguishes kanji vs word entries", async () => {
    await markForReview(db, 0, "火", "list-1", 3);
    expect(await isMarkedToday(db, 0, "火", 3)).toBe(true);
    expect(await isMarkedToday(db, 0, "水", 3)).toBe(false);
    expect(await isMarkedToday(db, 0, null, 3)).toBe(false);
  });
});

// ─── getMarkedByDay ───

describe("getMarkedByDay", () => {
  test("returns empty array when no marks", async () => {
    const result = await getMarkedByDay(db, 3);
    expect(result).toEqual([]);
  });

  test("groups marks into separate day bins", async () => {
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);

    const twoDaysAgo = new Date(now);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now.toISOString()],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m2", 1002, null, "list-1", now.toISOString()],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m3", 2001, null, "list-1", twoDaysAgo.toISOString()],
    );

    const result = await getMarkedByDay(db, 0);
    expect(result).toHaveLength(2);
    // Most recent bin first (today's 2 marks)
    expect(result[0].marks).toHaveLength(2);
    // Older bin second
    expect(result[1].marks).toHaveLength(1);
    // Day labels should be different
    expect(result[0].dayLabel).not.toBe(result[1].dayLabel);
  });

  test("filters by listId when provided", async () => {
    const now = new Date().toISOString();
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m2", 2001, null, "list-2", now],
    );

    const all = await getMarkedByDay(db, 3);
    expect(all[0].marks).toHaveLength(2);

    const filtered = await getMarkedByDay(db, 3, "list-1");
    expect(filtered[0].marks).toHaveLength(1);
    expect(filtered[0].marks[0].entryId).toBe(1001);
  });
});

// ─── getMarkedByWeek ───

describe("getMarkedByWeek", () => {
  test("returns empty array when no marks", async () => {
    const result = await getMarkedByWeek(db, 3);
    expect(result).toEqual([]);
  });

  test("groups marks into weeks", async () => {
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now.toISOString()],
    );

    const result = await getMarkedByWeek(db, 3);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].displayLabel).toBe("This Week");
    expect(result[0].marks).toHaveLength(1);
  });
});

// ─── getMarkedByMonth ───

describe("getMarkedByMonth", () => {
  test("returns empty array when no marks", async () => {
    const result = await getMarkedByMonth(db, 3);
    expect(result).toEqual([]);
  });

  test("groups marks into months with readable labels", async () => {
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now.toISOString()],
    );

    const result = await getMarkedByMonth(db, 3);
    expect(result).toHaveLength(1);
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    expect(monthNames).toContain(result[0].displayLabel);
  });
});

// ─── getMarkedEntryIds ───

describe("getMarkedEntryIds", () => {
  test("returns unique entry IDs within date range", async () => {
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + 1);

    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now.toISOString()],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m2", 1002, null, "list-1", now.toISOString()],
    );

    const result = await getMarkedEntryIds(db, start.toISOString(), end.toISOString());
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.entryId).sort()).toEqual([1001, 1002]);
  });

  test("filters by listId", async () => {
    const now = new Date().toISOString();
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", now],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m2", 2001, null, "list-2", now],
    );

    const result = await getMarkedEntryIds(
      db,
      "2020-01-01T00:00:00.000Z",
      "2030-01-01T00:00:00.000Z",
      "list-1",
    );
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe(1001);
  });
});

// ─── cleanupOldMarks ───

describe("cleanupOldMarks", () => {
  test("deletes marks older than keepDays", async () => {
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 100);
    const recent = new Date();

    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["old-1", 1001, null, "list-1", old.toISOString()],
    );
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["new-1", 2001, null, "list-1", recent.toISOString()],
    );

    await cleanupOldMarks(db, 90);

    const rows = await rawDb.getAllAsync<{ id: string }>("SELECT id FROM review_marks");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("new-1");
  });

  test("keeps marks within retention window", async () => {
    const recent = new Date();
    await rawDb.runAsync(
      "INSERT INTO review_marks (id, entry_id, kanji_literal, list_id, marked_at) VALUES (?, ?, ?, ?, ?)",
      ["m1", 1001, null, "list-1", recent.toISOString()],
    );

    await cleanupOldMarks(db, 90);

    const rows = await rawDb.getAllAsync("SELECT * FROM review_marks");
    expect(rows).toHaveLength(1);
  });
});
