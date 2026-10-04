import type { WrappedUserDb } from "@/db/user-db";
import { endOfLogicalDayISO } from "@/stores/simple-srs";
import { rtkReviewScope } from "./list-scope";

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
}

/**
 * What Review will actually ask, counted the way the engine queues it: a
 * learning card is due against the clock, a review card against the end of the
 * logical day, and a new card is one FSRS has never rated. Counting all three
 * against the end of the day would promise cards the session then withholds.
 */
export async function rtkReviewCounts(
  userDb: WrappedUserDb,
  dayResetHour: number,
): Promise<RtkReviewCounts> {
  const scope = rtkReviewScope();
  const nowISO = new Date().toISOString();
  const endOfDay = endOfLogicalDayISO(dayResetHour);

  const [learning, review, unseen] = await Promise.all([
    userDb.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM srs_cards
        WHERE ${scope.clause} AND state IN (1, 3) AND due <= ? AND deleted_at IS NULL`,
      [...scope.args, nowISO],
    ),
    userDb.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM srs_cards
        WHERE ${scope.clause} AND state = 2 AND due <= ? AND deleted_at IS NULL`,
      [...scope.args, endOfDay],
    ),
    userDb.getFirstAsync<{ n: number }>(
      // `simple_stage IS NULL` for the same reason the queue has it: a lesson
      // list left in simple_srs keeps its answered cards at state 0.
      `SELECT COUNT(*) AS n FROM srs_cards
        WHERE ${scope.clause} AND state = 0 AND simple_stage IS NULL AND deleted_at IS NULL`,
      [...scope.args],
    ),
  ]);

  return {
    due: (learning?.n ?? 0) + (review?.n ?? 0),
    unseen: unseen?.n ?? 0,
  };
}
