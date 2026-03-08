/**
 * Simple SRS engine.
 *
 * Model:
 * - Three actions: wrong (0), correct (1), easy (2)
 * - `n`: due date as days since 2001-01-01 (Mac/Core Foundation epoch), fractional
 * - `l`: interval in days until next review
 * - `s`: stage — 0 = learning/lapsed, 1 = graduated
 * - Due date = n (directly stored, not computed)
 * - Correct multiplier: ×1.9, Easy multiplier: ×2.6125 (1.9 × 1.375)
 * - Fail: preserve interval, reset correctCount, set n=0 (immediately due)
 * - Re-graduation (3 correct after lapse): interval ×0.5, clamp [1/3, 365]
 * - Normal graduation (never lapsed): interval ×1.9 (or ×2.6125), clamp [1/3, 365]
 * - Graduated cards due for review: pass once → done (recalculate interval)
 * - New/learning cards: need 3 correct in a row to graduate
 * - Initial interval: 0.3333 days (~8 hours)
 * - Max interval: 365 days
 */

import type { SrsCardRow } from "@/db/types";

const MAC_EPOCH_MS = new Date("2001-01-01T00:00:00Z").getTime();
const CORRECT_MULTIPLIER = 1.9;
const EASY_MULTIPLIER = 1.9 * 1.375; // 2.6125
const MAX_INTERVAL = 365;
const MIN_INTERVAL = 1 / 3; // 0.3333 days ≈ 8 hours
const INITIAL_INTERVAL = 1 / 3; // 0.3333 days ≈ 8 hours
const REQUIRED_CORRECT = 3; // correct answers needed to graduate from learning

/** Convert a JS Date to the app's day-based epoch (days since 2001-01-01). */
export function dateToSrsEpochDays(date: Date = new Date()): number {
  return (date.getTime() - MAC_EPOCH_MS) / (24 * 3600 * 1000);
}

/** Convert day-based epoch units back to JS Date. */
export function srsEpochDaysToDate(days: number): Date {
  return new Date(MAC_EPOCH_MS + days * 24 * 3600 * 1000);
}

/** Get the due date for a simple SRS card (as JS Date) */
export function getSimpleDueDate(card: SrsCardRow): Date | null {
  if (card.simpleN == null) return null;
  // n IS the due date directly
  return srsEpochDaysToDate(card.simpleN);
}

/** Check if a card is due for review */
export function isSimpleDue(card: SrsCardRow, now?: Date): boolean {
  const dueDate = getSimpleDueDate(card);
  if (!dueDate) return false;
  return dueDate <= (now ?? new Date());
}

/**
 * Get the end of the current logical day in day-based epoch units.
 * Cards due before this cutoff are shown as "due today".
 *  */
export function endOfLogicalDayEpochDays(resetHour: number, now?: Date): number {
  return dateToSrsEpochDays(getEndOfLogicalDay(resetHour, now));
}

/**
 * Get the end of the current logical day as an ISO string (for FSRS due queries).
 * Uses the same logic as endOfLogicalDayEpochDays but returns a string for SQL comparison.
 */
export function endOfLogicalDayISO(resetHour: number, now?: Date): string {
  return getEndOfLogicalDay(resetHour, now).toISOString();
}

/**
 * Get the end of the current logical day as a Date.
 * If now is before resetHour, the logical day ends at resetHour today.
 * If now is at or after resetHour, the logical day ends at resetHour tomorrow.
 * Uses local time — timezone-agnostic (traveling shifts the cutoff naturally).
 */
export function getEndOfLogicalDay(resetHour: number, now?: Date): Date {
  const ref = now ?? new Date();
  const cutoff = new Date(ref);
  if (ref.getHours() < resetHour) {
    cutoff.setHours(resetHour, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() + 1);
    cutoff.setHours(resetHour, 0, 0, 0);
  }
  return cutoff;
}

/**
 * Process a correct/easy answer for a card that has reached the graduation
 * threshold (3 correct in a row). Returns updated simple SRS fields.
 *
 * @param card - The SRS card being reviewed
 * @param easy - Whether this was an "easy" action (long-press pass)
 * @param hasLapsed - Whether the card has ever been failed (lapses > 0)
 */
export function simpleGraduate(
  card: SrsCardRow,
  easy: boolean,
  hasLapsed: boolean,
): {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
} {
  const now = dateToSrsEpochDays();
  let newInterval: number;

  if (hasLapsed) {
    // Re-graduating after a lapse: halve the interval, clamp [1/3, 365]
    const currentInterval = card.simpleInterval ?? INITIAL_INTERVAL;
    newInterval = Math.max(MIN_INTERVAL, Math.min(currentInterval * 0.5, MAX_INTERVAL));
  } else {
    // Normal pass: multiply interval
    const currentInterval = card.simpleInterval ?? INITIAL_INTERVAL;
    const multiplier = easy ? EASY_MULTIPLIER : CORRECT_MULTIPLIER;
    newInterval = Math.max(MIN_INTERVAL, Math.min(currentInterval * multiplier, MAX_INTERVAL));
  }

  return {
    simpleStage: 1,
    simpleN: now + newInterval, // n = due date
    simpleInterval: newInterval,
  };
}

/** Process a fail review — returns updated simple SRS fields */
export function simpleReviewFail(card: SrsCardRow): {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
} {
  // Fail: preserve interval, set stage to 0 (learning), n=0 (immediately due)
  return {
    simpleStage: 0,
    simpleN: 0,
    simpleInterval: card.simpleInterval ?? INITIAL_INTERVAL,
  };
}

/** Initialize a new card for simple SRS (first time seeing it) */
export function simpleInitCard(): {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
} {
  return {
    simpleStage: 0,
    simpleN: 0, // immediately due (in learning)
    simpleInterval: INITIAL_INTERVAL,
  };
}

/** Number of correct answers needed to graduate from learning */
export const SIMPLE_SRS_REQUIRED_CORRECT = REQUIRED_CORRECT;
