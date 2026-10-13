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
 * - Re-graduation (3 correct after lapse): interval ×0.5, clamp [1/3, 365].
 *   ONCE — the halving belongs to the lapse being recovered from, not to the
 *   card's history. Scoped to `lapses > 0` instead, every pass after a card's
 *   first ever failure halved it, so the interval ratcheted down to the floor
 *   and the card was due every 8 hours for the rest of its life.
 * - Normal graduation (never lapsed): interval ×1.9 (or ×2.6125), clamp [1/3, 365]
 * - Graduated cards due for review: pass once → done (recalculate interval)
 * - New/learning cards: need 3 correct in a row to graduate
 * - Initial interval: 0.3333 days (~8 hours)
 * - Max interval: 365 days
 */

import type { SrsCardRow } from "@/db/types";

/** Every field a simple-SRS review writes back to `srs_cards`. */
export interface SimpleSrsUpdate {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
  simpleRelearning: number;
  /** Correct answers in a row, toward the three a learning card needs. */
  simpleRun: number;
}

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
 */
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
 * @param isRelearning - Whether the card is recovering from a lapse right now
 */
export function simpleGraduate(
  card: SrsCardRow,
  easy: boolean,
  isRelearning: boolean,
): SimpleSrsUpdate {
  const now = dateToSrsEpochDays();
  let newInterval: number;

  if (isRelearning) {
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
    // The lapse this graduation recovered from is paid for.
    simpleRelearning: 0,
    simpleRun: 0,
  };
}

/** Process a fail review — returns updated simple SRS fields */
export function simpleReviewFail(card: SrsCardRow): SimpleSrsUpdate {
  // Fail: preserve interval, set stage to 0 (learning), n=0 (immediately due)
  return {
    simpleStage: 0,
    simpleN: 0,
    simpleInterval: card.simpleInterval ?? INITIAL_INTERVAL,
    simpleRelearning: 1,
    simpleRun: 0,
  };
}

/** Initialize a new card for simple SRS (first time seeing it) */
export function simpleInitCard(): SimpleSrsUpdate {
  return {
    simpleStage: 0,
    simpleN: 0, // immediately due (in learning)
    simpleInterval: INITIAL_INTERVAL,
    simpleRelearning: 0,
    simpleRun: 0,
  };
}

/** Number of correct answers needed to graduate from learning */
export const SIMPLE_SRS_REQUIRED_CORRECT = REQUIRED_CORRECT;

/** What a single simple-SRS answer does to a card. */
export interface SimpleSrsDecision {
  updates: SimpleSrsUpdate;
  /** Whether the card leaves the session, or is re-queued to be asked again. */
  graduated: boolean;
}

/**
 * Decide one simple-SRS answer.
 *
 * Extracted from the study screen so the WIRING is testable: the lapse bug
 * lived here, in which flag the call site handed to `simpleGraduate`, and a
 * test that only called `simpleGraduate` could not see it.
 */
export function nextSimpleReview(
  card: SrsCardRow,
  action: "pass" | "easy" | "fail",
): SimpleSrsDecision {
  const isNew = card.simpleStage == null;
  const relearning = card.simpleRelearning === 1;

  if (action === "fail") {
    return { updates: isNew ? simpleInitCard() : simpleReviewFail(card), graduated: false };
  }

  if (action === "easy") {
    // Easy skips the correct-in-a-row gate and graduates at once.
    const base = isNew ? { ...card, ...simpleInitCard() } : card;
    return { updates: simpleGraduate(base, true, relearning), graduated: true };
  }

  if (isNew) {
    // First sight: start the card and start counting.
    return { updates: { ...simpleInitCard(), simpleRun: 1 }, graduated: false };
  }

  if (card.simpleStage === 1) {
    // Graduated and due: one correct answer settles it.
    return { updates: simpleGraduate(card, false, relearning), graduated: true };
  }

  const run = (card.simpleRun ?? 0) + 1;
  if (run >= REQUIRED_CORRECT) {
    return { updates: simpleGraduate(card, false, relearning), graduated: true };
  }
  return {
    updates: {
      simpleStage: 0,
      simpleN: 0, // immediately due
      simpleInterval: card.simpleInterval ?? 0,
      // Still inside the lapse it is recovering from, if it was in one.
      simpleRelearning: card.simpleRelearning ?? 0,
      simpleRun: run,
    },
    graduated: false,
  };
}
