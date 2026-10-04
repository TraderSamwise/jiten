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
import { endOfLogicalDayISO } from "@/stores/simple-srs";
import {
  ensureRtkReviewList,
  nextCardLine,
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
  /** Defaults to the id; two cards can name the same frame. */
  literal?: string;
  simpleStage?: number | null;
  deleted?: boolean;
}

async function card({
  id,
  list,
  state,
  due,
  literal,
  simpleStage = null,
  deleted = false,
}: CardSpec) {
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
    [id, literal ?? id, list, due, state, simpleStage, now, now, deleted ? now : null],
  );
}

async function dueOf(id: string): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ due: string }>("SELECT due FROM srs_cards WHERE id = ?", [
    id,
  ]);
  return row?.due;
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
  it("reports the cutoff the counts were taken against", async () => {
    // The pane reads nextDueAt against this, not against its own clock: across
    // the reset hour the two disagree.
    const counts = await rtkReviewCounts(db, RESET_HOUR);
    expect(counts.dueThrough).toBe(endOfLogicalDayISO(RESET_HOUR));
  });

  it("counts nothing before a node is crowned", async () => {
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({
      due: 0,
      unseen: 0,
      scheduled: 0,
      nextDueAt: null,
    });
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
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({
      due: 0,
      unseen: 1,
      scheduled: 1,
      // A new card's due is its creation time, already past: it is not "next".
      nextDueAt: null,
    });
  });

  it("leaves out a card answered under simple_srs", async () => {
    // simple_srs never writes `state`, so these sit at 0 forever and the queue
    // excludes them; counting them would promise cards the session withholds.
    await card({ id: "a", list: lessonListId(2), state: 0, due: iso(0), simpleStage: 2 });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({
      due: 0,
      unseen: 0,
      // Carded all the same: "scheduled" means a live card exists, and this one
      // does — it is simply invisible to the FSRS queue.
      scheduled: 1,
      nextDueAt: null,
    });
  });

  it("leaves out a deleted card", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(-HOUR), deleted: true });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({
      due: 0,
      unseen: 0,
      scheduled: 0,
      nextDueAt: null,
    });
  });

  it("counts across the lessons, and only the lessons", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(-HOUR) });
    await card({ id: "b", list: lessonListId(56), state: 2, due: iso(-HOUR) });
    await card({ id: "c", list: "my-list", state: 2, due: iso(-HOUR) });
    await card({ id: "d", list: RTK_REVIEW_LIST_ID, state: 2, due: iso(-HOUR) });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 2 });
  });
});

describe("how many frames are carded", () => {
  it("counts a frame once however many rows it has", async () => {
    // Nothing stops two rows for one frame (lib/rtk-graduate.ts says so), and
    // the lesson lists are ordinary editable lists, so COUNT(*) could read
    // higher than the course is long.
    await card({ id: "x", list: lessonListId(1), state: 2, due: iso(HOUR * 48), literal: "日" });
    await card({ id: "y", list: lessonListId(2), state: 2, due: iso(HOUR * 48), literal: "日" });
    expect((await rtkReviewCounts(db, RESET_HOUR)).scheduled).toBe(1);
  });

  it("counts a carded frame that is not due yet", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(HOUR * 48) });
    const counts = await rtkReviewCounts(db, RESET_HOUR);
    expect(counts).toMatchObject({ due: 0, unseen: 0, scheduled: 1 });
  });
});

describe("when the next card arrives", () => {
  it("names a learning card due later today, which is not due yet", async () => {
    // Due in two hours, and the pane must not round that up to "today" or down
    // to "now": state 1 is measured against the clock.
    const due = iso(2 * HOUR);
    await card({ id: "a", list: lessonListId(1), state: 1, due });
    expect(await rtkReviewCounts(db, RESET_HOUR)).toMatchObject({ due: 0, nextDueAt: due });
  });

  it("names the earliest of them", async () => {
    await card({ id: "late", list: lessonListId(1), state: 2, due: iso(HOUR * 96) });
    await card({ id: "soon", list: lessonListId(2), state: 2, due: iso(HOUR * 48) });
    const counts = await rtkReviewCounts(db, RESET_HOUR);
    expect(counts.nextDueAt).toBe(await dueOf("soon"));
  });

  it("never names a moment that has already gone", async () => {
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(-HOUR) });
    await card({ id: "b", list: lessonListId(1), state: 0, due: iso(-HOUR * 5) });
    const counts = await rtkReviewCounts(db, RESET_HOUR);
    expect(counts.nextDueAt).toBeNull();
    expect(counts.due).toBe(1);
  });

  it("ignores a deleted card that would have been next", async () => {
    // A live card behind it, so this cannot pass by naming nothing at all.
    await card({ id: "gone", list: lessonListId(1), state: 2, due: iso(HOUR * 24), deleted: true });
    await card({ id: "live", list: lessonListId(1), state: 2, due: iso(HOUR * 96) });
    expect((await rtkReviewCounts(db, RESET_HOUR)).nextDueAt).toBe(await dueOf("live"));
  });

  it("says nothing is next when the only other card is due today", async () => {
    // It is already counted in `due`; naming it as "next" would contradict that.
    await card({ id: "a", list: lessonListId(1), state: 2, due: iso(2 * HOUR) });
    const counts = await rtkReviewCounts(db, RESET_HOUR);
    expect(counts.due).toBe(1);
    expect(counts.nextDueAt).toBeNull();
  });
});

describe("saying when the next card arrives", () => {
  // 14:00 with a 03:00 reset: the day is out at 03:00 tomorrow.
  const now = new Date("2026-06-15T14:00:00");
  const dueThrough = new Date("2026-06-16T03:00:00").toISOString();
  const line = (dueAt: string | null) => nextCardLine(dueAt, dueThrough, now);

  it("says nothing when no card is waiting", () => {
    expect(line(null)).toBe("Every crowned frame is scheduled.");
  });

  it("counts the hours for a card still coming today", () => {
    expect(line(new Date("2026-06-15T16:00:00").toISOString())).toBe("Next card in 2h.");
  });

  it("says tomorrow for a card just past the cutoff", () => {
    expect(line(new Date("2026-06-16T09:00:00").toISOString())).toBe("Next card tomorrow.");
  });

  it("does not call the day after tomorrow 'tomorrow'", () => {
    // 35 hours past the cutoff. Rounding said 1, and 1 said tomorrow.
    expect(line(new Date("2026-06-17T14:00:00").toISOString())).toBe("Next card in 2 days.");
  });

  it("counts whole days further out", () => {
    expect(line(new Date("2026-06-29T10:00:00").toISOString())).toBe("Next card in 14 days.");
  });

  it("falls back rather than printing an invalid date", () => {
    expect(line("not a date")).toBe("Every crowned frame is scheduled.");
  });
});
