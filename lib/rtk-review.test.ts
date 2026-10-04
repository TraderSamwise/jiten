/**
 * The review session's settings row, and the count the Review tab promises.
 *
 * Two traps are pinned here. The row is `is_default = 1` because a non-default
 * list makes `hasLocalData()` true (db/sync-helpers.ts counts `lists WHERE
 * is_default = 0`), so merely opening Review would have asked a brand-new
 * account whether to merge its data. And the count has to match what the queue
 * actually asks: a review card is due against the end of the logical day, a
 * learning card against the clock.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@/test/test-db";
import type { WrappedUserDb } from "@/db/user-db";
import { parseFaces } from "./card-faces";
import { lessonListId } from "./rtk-graduate";
import { makeDefaultListId } from "./seed-default-lists";
import {
  ensureRtkReviewList,
  isRtkReviewList,
  RTK_REVIEW_LIST_ID,
  rtkReviewCounts,
} from "./rtk-review";

let db: WrappedUserDb & { close: () => void };

const RESET_HOUR = 3;

beforeEach(() => {
  if (db) db.close();
  db = createTestDb();
  // Pinned at midday: between 01:00 and 02:59 the end of the logical day is
  // 03:00 TODAY, so "due in two hours" would fall outside it and the test
  // would fail for two hours a night.
  vi.setSystemTime(new Date("2026-06-15T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (db) db.close();
});

interface CardSpec {
  id: string;
  list: string;
  state: number;
  due: string;
  simpleStage?: number | null;
  deleted?: boolean;
}

async function card({ id, list, state, due, simpleStage = null, deleted = false }: CardSpec) {
  const now = new Date().toISOString();
  // srs_cards.list_id has a foreign key, and the point of the scope is that
  // these cards stay in their own lesson lists.
  await db.runAsync(
    "INSERT OR IGNORE INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
    [list, list, now, now],
  );
  await db.runAsync(
    `INSERT INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty,
       elapsed_days, scheduled_days, reps, lapses, state, simple_stage, front_mode, back_mode,
       created_at, updated_at, deleted_at)
     VALUES (?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, 'kanji', 'english', ?, ?, ?)`,
    [id, id, list, due, state, simpleStage, now, now, deleted ? now : null],
  );
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const HOUR = 60 * 60 * 1000;

describe("the review list", () => {
  it("knows its own id", () => {
    expect(isRtkReviewList(RTK_REVIEW_LIST_ID)).toBe(true);
    expect(isRtkReviewList(lessonListId(3))).toBe(false);
    expect(isRtkReviewList(null)).toBe(false);
  });

  it("asks the keyword and answers with the character", async () => {
    await ensureRtkReviewList(db);
    const row = await db.getFirstAsync<{
      flashcard_mode: string;
      front_faces: string;
      back_faces: string;
      configured: number;
    }>("SELECT flashcard_mode, front_faces, back_faces, configured FROM lists WHERE id = ?", [
      RTK_REVIEW_LIST_ID,
    ]);
    expect(row?.flashcard_mode).toBe("srs");
    expect(parseFaces(row?.front_faces, [])).toEqual(["keyword"]);
    expect(parseFaces(row?.back_faces, [])).toEqual(["kanji", "mnemonic"]);
    expect(row?.configured).toBe(1);
  });

  it("stays out of the count that triggers the merge prompt", async () => {
    // hasLocalData() counts `lists WHERE is_default = 0`.
    await ensureRtkReviewList(db);
    const row = await db.getFirstAsync<{ is_default: number }>(
      "SELECT is_default FROM lists WHERE id = ?",
      [RTK_REVIEW_LIST_ID],
    );
    expect(row?.is_default).toBe(1);
    const counted = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lists WHERE is_default = 0",
    );
    expect(counted?.n).toBe(0);
  });

  it("carries the id a default-list migration would give it", () => {
    // That pass renames every is_default = 1 row to makeDefaultListId(name),
    // and a local reset clears the flag that stops it from running again.
    expect(RTK_REVIEW_LIST_ID).toBe(makeDefaultListId("RTK Review"));
  });

  it("holds no entries and no cards of its own", async () => {
    await ensureRtkReviewList(db);
    const entries = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ?",
      [RTK_REVIEW_LIST_ID],
    );
    const cards = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM srs_cards WHERE list_id = ?",
      [RTK_REVIEW_LIST_ID],
    );
    expect(entries?.n).toBe(0);
    expect(cards?.n).toBe(0);
  });

  it("corrects a row an older build left behind", async () => {
    // There is no settings modal for a scoped session, so a stale row could
    // otherwise decide how the review asks for good.
    await ensureRtkReviewList(db);
    await db.runAsync(
      "UPDATE lists SET front_faces = ?, flashcard_mode = 'add_order', voice_mode = 1 WHERE id = ?",
      [JSON.stringify(["english"]), RTK_REVIEW_LIST_ID],
    );
    await ensureRtkReviewList(db);
    const row = await db.getFirstAsync<{
      front_faces: string;
      flashcard_mode: string;
      voice_mode: number;
    }>("SELECT front_faces, flashcard_mode, voice_mode FROM lists WHERE id = ?", [
      RTK_REVIEW_LIST_ID,
    ]);
    expect(parseFaces(row?.front_faces, [])).toEqual(["keyword"]);
    expect(row?.flashcard_mode).toBe("srs");
    expect(row?.voice_mode).toBe(0);
  });

  it("brings the row back if it was soft-deleted", async () => {
    await ensureRtkReviewList(db);
    const now = new Date().toISOString();
    await db.runAsync("UPDATE lists SET deleted_at = ? WHERE id = ?", [now, RTK_REVIEW_LIST_ID]);
    await ensureRtkReviewList(db);
    const row = await db.getFirstAsync<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM lists WHERE id = ?",
      [RTK_REVIEW_LIST_ID],
    );
    expect(row?.deleted_at).toBeNull();
  });
});

describe("counting what the review will ask", () => {
  it("counts nothing before a node is crowned", async () => {
    expect(await rtkReviewCounts(db, RESET_HOUR)).toEqual({ due: 0, unseen: 0 });
  });

  it("counts a review card due later today", async () => {
    // state 2 is measured against the end of the logical day, as the queue does.
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(2 * HOUR) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 1 });
  });

  it("does not count a learning card due later today", async () => {
    // state 1 is measured against the clock: the session will not ask it yet,
    // so promising it on the tab would be a lie.
    await card({ id: "a", list: lessonListId(1), state: 1, due: iso(2 * HOUR) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 0 });
  });

  it("counts a learning card already due", async () => {
    await card({ id: "a", list: lessonListId(1), state: 3, due: iso(-HOUR) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 1 });
  });

  it("counts a crowned frame FSRS has never shown as unseen, not due", async () => {
    await card({ id: "a", list: lessonListId(2), state: 0, due: iso(0) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toEqual({ due: 0, unseen: 1 });
  });

  it("leaves out a card answered under simple_srs", async () => {
    // simple_srs never writes `state`, so these sit at 0 forever and the queue
    // excludes them; counting them would promise cards the session withholds.
    await card({ id: "a", list: lessonListId(2), state: 0, due: iso(0), simpleStage: 2 });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toEqual({ due: 0, unseen: 0 });
  });

  it("leaves out a deleted card", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(-HOUR), deleted: true });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toEqual({ due: 0, unseen: 0 });
  });

  it("counts across the lessons, and only the lessons", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(-HOUR) });
    await card({ id: "b", list: lessonListId(56), state: 2, due: iso(-HOUR) });
    await card({ id: "c", list: "my-list", state: 2, due: iso(-HOUR) });
    await card({ id: "d", list: RTK_REVIEW_LIST_ID, state: 2, due: iso(-HOUR) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 2 });
  });
});
