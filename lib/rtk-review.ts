import type { WrappedUserDb } from "@/db/user-db";
import { endOfLogicalDayISO } from "@/stores/simple-srs";
import { rtkReviewScope } from "./list-scope";
import { formatInterval } from "./format-interval";

/**
 * Reviewing the whole course in the flashcard engine.
 *
 * The cards live in the 56 lesson lists and stay there — a session is SCOPED to
 * them (lib/list-scope.ts), so there is one FSRS state per frame. This row
 * holds nothing but the settings that session runs under: no entries, no cards.
 */

export const RTK_REVIEW_LIST_ID = "default-rtk-review";

export function isRtkReviewList(id: string | null | undefined): boolean {
  return id === RTK_REVIEW_LIST_ID;
}

/**
 * `is_default = 1` deliberately. A non-default list makes `hasLocalData()`
 * true (db/sync-helpers.ts counts `lists WHERE is_default = 0`), so merely
 * opening Review would have asked a brand-new account whether to merge its
 * data. The cost is that the row does not sync — but every column here is a
 * code constant, so there is nothing to carry between devices.
 *
 * `updated_at` is left alone on an existing row: it syncs nowhere, and
 * touching it on every visit to the tab would be noise.
 */
export async function ensureRtkReviewList(userDb: WrappedUserDb): Promise<void> {
  const now = new Date().toISOString();
  await userDb.runAsync(
    `INSERT INTO lists
       (id, name, description, flashcard_mode, front_faces, back_faces, configured,
        voice_mode, typing_mode, mnemonic_cloze, is_default, created_at, updated_at)
     VALUES (?, ?, NULL, 'srs', ?, ?, 1, 0, 0, 0, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       flashcard_mode = excluded.flashcard_mode,
       front_faces = excluded.front_faces,
       back_faces = excluded.back_faces,
       configured = 1,
       voice_mode = 0,
       typing_mode = 0,
       deleted_at = NULL`,
    [
      RTK_REVIEW_LIST_ID,
      "RTK Review",
      // Heisig's own direction: the keyword asks, the character answers.
      JSON.stringify(["keyword"]),
      JSON.stringify(["kanji", "mnemonic"]),
      now,
      now,
    ],
  );
}

export interface RtkReviewCounts {
  /** Cards the session will ask today because they are due. */
  due: number;
  /** Graduated frames FSRS has never shown. */
  unseen: number;
  /**
   * Frames that have become flashcards at all, counted by character: the
   * lesson lists are ordinary editable lists and nothing stops two rows for
   * one frame, so `COUNT(*)` could read higher than the course is long.
   */
  scheduled: number;
  /**
   * When the next card that is NOT due now becomes due, or null if there is
   * none. Only meaningful while `due` is 0 — otherwise there is something to
   * do already.
   */
  nextDueAt: string | null;
  /**
   * The cutoff the counts were taken against. The caller reads `nextDueAt`
   * against this one rather than recomputing: across the reset hour those two
   * disagree, and the pane would call a card due in two hours "not due".
   */
  dueThrough: string;
}

/**
 * What Review will actually ask, counted the way the engine queues it: a
 * learning card is due against the clock, a review card against the end of the
 * logical day, and a new card is one FSRS has never rated. Counting all three
 * against the end of the day would promise cards the session then withholds.
 *
 * One statement, conditional aggregates: five would bind the 56 ids five times
 * and walk the table five times, on a screen that reloads on every focus.
 */
export async function rtkReviewCounts(
  userDb: WrappedUserDb,
  dayResetHour: number,
): Promise<RtkReviewCounts> {
  const scope = rtkReviewScope();
  const nowISO = new Date().toISOString();
  const endOfDay = endOfLogicalDayISO(dayResetHour);

  const row = await userDb.getFirstAsync<{
    // SUM over no matching rows is NULL, not 0.
    due: number | null;
    unseen: number | null;
    scheduled: number;
    next_due: string | null;
  }>(
    `SELECT
       SUM(CASE WHEN state IN (1, 3) AND due <= ? THEN 1 ELSE 0 END)
         + SUM(CASE WHEN state = 2 AND due <= ? THEN 1 ELSE 0 END) AS due,
       -- simple_stage IS NULL for the same reason the queue has it: a lesson
       -- list left in simple_srs keeps its answered cards at state 0.
       SUM(CASE WHEN state = 0 AND simple_stage IS NULL THEN 1 ELSE 0 END) AS unseen,
       COUNT(DISTINCT kanji_literal) AS scheduled,
       -- The exact complement of the two due tests, with state 0 left out: a
       -- new card's due is its creation time, already past, so including it
       -- would name a moment that has gone as the next one coming.
       MIN(CASE
             WHEN state IN (1, 3) AND due > ? THEN due
             WHEN state = 2 AND due > ? THEN due
           END) AS next_due
     FROM srs_cards
     WHERE ${scope.clause} AND deleted_at IS NULL`,
    // SQLite binds positionally in TEXTUAL order, and these four sit in the
    // SELECT list, ahead of the scope's own placeholders in the WHERE.
    [nowISO, endOfDay, nowISO, endOfDay, ...scope.args],
  );

  return {
    due: row?.due ?? 0,
    unseen: row?.unseen ?? 0,
    scheduled: row?.scheduled ?? 0,
    nextDueAt: row?.next_due ?? null,
    dueThrough: endOfDay,
  };
}

/**
 * What the pane says when nothing is due: when the next card arrives, which is
 * the difference between a screen that waits and one that looks broken.
 *
 * Hours for a card coming before the day is out, days beyond it — counted with
 * `ceil`, because a card 35 hours past the cutoff falls on the day after
 * tomorrow and rounding called it tomorrow.
 */
export function nextCardLine(
  nextDueAt: string | null,
  dueThrough: string,
  now: Date = new Date(),
): string {
  if (!nextDueAt) return "Every crowned frame is scheduled.";
  const next = new Date(nextDueAt);
  if (Number.isNaN(next.getTime())) return "Every crowned frame is scheduled.";
  const cutoff = new Date(dueThrough);
  if (next <= cutoff) return `Next card in ${formatInterval(next, now)}.`;
  const days = Math.ceil((next.getTime() - cutoff.getTime()) / 86_400_000);
  return days <= 1 ? "Next card tomorrow." : `Next card in ${days} days.`;
}
