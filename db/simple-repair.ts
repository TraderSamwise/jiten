/**
 * Lift simple-SRS cards the lapse bug ratcheted to the 8-hour floor.
 *
 * This runs on every launch rather than once as a migration, and both halves
 * of that matter:
 *
 * - It cannot bump `updated_at`. A device opened for the first time in months
 *   would become the newest writer of every card it touched, and sync skips the
 *   remote row when `localTs >= remoteTs` — so it would push months-old values
 *   over reviews done elsewhere.
 * - Which means the repair never travels, so a device still on an old build can
 *   push a ratcheted `simple_interval` back. As a one-shot migration keyed to
 *   `PRAGMA user_version` the repair was then gone for good. Run every launch,
 *   it simply happens again.
 *
 * The clause is self-limiting: a repaired row no longer matches it, so this is
 * one indexed UPDATE that changes nothing on a healthy deck.
 */

import type { WrappedUserDb } from "./user-db";

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
 * The spread starts at 2 so a repaired row can never match again, which is what
 * makes running this repeatedly free.
 */
export const REPAIR_RATCHETED_INTERVALS = `UPDATE srs_cards SET
     simple_interval = 2 + (rowid % 29),
     simple_n = (julianday('now') - julianday('2001-01-01')) + 2 + (rowid % 29)
   WHERE simple_stage = 1 AND simple_interval <= 0.34 AND lapses > 0 AND reps >= 12
     AND deleted_at IS NULL`;

/** Returns how many cards were lifted, for the log. */
export async function repairRatchetedIntervals(db: WrappedUserDb): Promise<number> {
  try {
    const result = await db.runAsync(REPAIR_RATCHETED_INTERVALS, []);
    return result?.changes ?? 0;
  } catch (err) {
    // A deck left at the floor is bad; a launch that fails because of it is
    // worse. The next launch tries again.
    console.warn("[SimpleSRS] Interval repair skipped:", err);
    return 0;
  }
}
