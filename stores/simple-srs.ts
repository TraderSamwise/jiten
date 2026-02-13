/**
 * Simple SRS engine.
 *
 * Algorithm (documented from Midori's data):
 * - Binary pass/fail (no hard/easy ratings)
 * - `n`: last-review timestamp as days since 2001-01-01 (Mac epoch), fractional
 * - `l`: interval in days until next review
 * - `s`: stage — 0 = learning, 1 = graduated
 * - Due date = n + l (in same day units)
 * - Pass multiplier: ×1.9
 * - Fail: reset to stage 0, interval = 0.3333 days (8 hours)
 * - Max interval: 365 days
 * - Initial interval: 0.3333 days
 * - Graduation: after passing with stage 0, promote to stage 1
 */

import type { SrsCardRow } from "@/db/types";

const MAC_EPOCH_MS = new Date("2001-01-01T00:00:00Z").getTime();
const MULTIPLIER = 1.9;
const MAX_INTERVAL = 365;
const INITIAL_INTERVAL = 1 / 3; // 0.3333 days ≈ 8 hours
const GRADUATION_INTERVAL = 1; // 1 day when graduating from stage 0

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
  if (card.simpleN == null || card.simpleInterval == null) return null;
  return srsEpochDaysToDate(card.simpleN + card.simpleInterval);
}

/** Check if a card is due for review */
export function isSimpleDue(card: SrsCardRow, now?: Date): boolean {
  const dueDate = getSimpleDueDate(card);
  if (!dueDate) return false;
  return dueDate <= (now ?? new Date());
}

/** Filter cards that are currently due */
export function getSimpleDueCards(cards: SrsCardRow[], now?: Date): SrsCardRow[] {
  const n = now ?? new Date();
  return cards
    .filter((c) => c.simpleStage != null && isSimpleDue(c, n))
    .sort((a, b) => {
      // Sort by due date ascending (most overdue first)
      const aDue = a.simpleN! + a.simpleInterval!;
      const bDue = b.simpleN! + b.simpleInterval!;
      return aDue - bDue;
    });
}

/** Get new cards (not yet started, simpleStage === null) */
export function getSimpleNewCards(cards: SrsCardRow[], limit: number): SrsCardRow[] {
  return cards.filter((c) => c.simpleStage == null).slice(0, limit);
}

/** Process a pass review — returns updated simple SRS fields */
export function simpleReviewPass(card: SrsCardRow): {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
} {
  const now = dateToSrsEpochDays();

  if (card.simpleStage === 0) {
    // Graduating from learning to review
    return {
      simpleStage: 1,
      simpleN: now,
      simpleInterval: GRADUATION_INTERVAL,
    };
  }

  // Stage 1 (review): multiply interval
  const currentInterval = card.simpleInterval ?? INITIAL_INTERVAL;
  const newInterval = Math.min(currentInterval * MULTIPLIER, MAX_INTERVAL);

  return {
    simpleStage: 1,
    simpleN: now,
    simpleInterval: newInterval,
  };
}

/** Process a fail review — returns updated simple SRS fields */
export function simpleReviewFail(card: SrsCardRow): {
  simpleStage: number;
  simpleN: number;
  simpleInterval: number;
} {
  return {
    simpleStage: 0,
    simpleN: dateToSrsEpochDays(),
    simpleInterval: INITIAL_INTERVAL,
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
    simpleN: dateToSrsEpochDays(),
    simpleInterval: INITIAL_INTERVAL,
  };
}
