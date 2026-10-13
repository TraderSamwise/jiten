/**
 * Lift simple-SRS cards the lapse bug ratcheted to the 8-hour floor.
 *
 * ONCE per device, keyed to an `app_flags` row. Both halves of that matter, and
 * both were got wrong first:
 *
 * - It cannot bump `updated_at`. A device opened for the first time in months
 *   would become the newest writer of every card it touched, and sync skips the
 *   remote row when `localTs >= remoteTs` — so it would push months-old values
 *   over reviews done elsewhere.
 * - It cannot run on every launch. The clause matches rows the FIXED engine
 *   legitimately produces: a card that fails and re-graduates from a short
 *   interval lands at exactly `MIN_INTERVAL`, so three honest lapses leave it at
 *   1/3 with `reps = 15` and `lapses = 3`, matching every condition. As a
 *   one-time repair that is a bounded cost, measured and accepted in
 *   docs/simple-srs-decisions.md. Run on every launch it becomes a standing
 *   policy that pushes a learner's hardest cards a month out, again and again.
 *
 * The cost of running once is that a device still on an old build can push a
 * ratcheted interval back afterwards, and nothing lifts it again. That is the
 * better trade: one stale card against repeatedly burying the words someone is
 * working hardest on.
 */

import type { WrappedUserDb } from "./user-db";

/** The `app_flags` key that records this device has run the repair. */
export const REPAIR_FLAG = "simple_intervals_repaired";

/**
 * `reps >= 12` is the discriminator, measured rather than guessed: a card the
 * bug ratcheted down from 56 days has a median of 32 answers behind it, while
 * one honestly at the floor has 4. `lapses >= 3` was the obvious guard and is
 * wrong — under the bug a single lapse starts the ratchet, so it misses a third
 * of them and lifts more honest cards. `yarn simulate:srs discriminate`.
 *
 * `simple_stage = 1` only: a learning card sits at 1/3 because that is where
 * new cards START, and with the whole list loading as new those are most of the
 * stage-0 population. They are bounded by the learning cap instead.
 *
 * The spread starts at 2 so a repaired row can never match again, which keeps
 * the statement idempotent even though the flag already stops it re-running.
 */
export const REPAIR_RATCHETED_INTERVALS = `UPDATE srs_cards SET
     simple_interval = 2 + (rowid % 29),
     simple_n = (julianday('now') - julianday('2001-01-01')) + 2 + (rowid % 29)
   WHERE simple_stage = 1 AND simple_interval <= 0.34 AND lapses > 0 AND reps >= 12
     AND deleted_at IS NULL`;

/**
 * Run the repair if this device has not. Returns how many cards were lifted, or
 * -1 if it had already run.
 *
 * "Has not" means the flag is absent, and the flag is only written once the
 * device has actually seen a simple-SRS deck — see below.
 */
export async function repairRatchetedIntervals(db: WrappedUserDb): Promise<number> {
  try {
    const done = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_flags WHERE key = ?",
      [REPAIR_FLAG],
    );
    if (done) return -1;

    const result = await db.runAsync(REPAIR_RATCHETED_INTERVALS, []);

    // Only claim the repair is done once there was a deck to repair. A fresh
    // install has no cards yet: writing the flag then would spend the one run
    // on an empty table, and the ratcheted deck arriving on the next sync pull
    // would stay flattened forever, with no path back — the repair never
    // pushes, so the remote copy is flattened too. A reinstall is the common
    // way a user meets this, not an edge case.
    const seen = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM srs_cards WHERE simple_stage IS NOT NULL",
    );
    if ((seen?.c ?? 0) > 0) {
      await db.runAsync("INSERT OR REPLACE INTO app_flags (key, value) VALUES (?, ?)", [
        REPAIR_FLAG,
        new Date().toISOString(),
      ]);
    }
    return result?.changes ?? 0;
  } catch (err) {
    // A deck left at the floor is bad; a launch that fails because of it is
    // worse. The flag is not written, so the next launch tries again.
    console.warn("[SimpleSRS] Interval repair skipped:", err);
    return 0;
  }
}
