import { describe, test, expect } from "vitest";
import {
  nextSimpleReview,
  dateToSrsEpochDays,
  srsEpochDaysToDate,
  getSimpleDueDate,
  isSimpleDue,
  getEndOfLogicalDay,
  endOfLogicalDayEpochDays,
  endOfLogicalDayISO,
  simpleGraduate,
  simpleReviewFail,
  simpleInitCard,
  SIMPLE_SRS_REQUIRED_CORRECT,
} from "./simple-srs";
import type { SrsCardRow } from "@/db/types";

// ─── Epoch conversion ───

describe("dateToSrsEpochDays / srsEpochDaysToDate", () => {
  test("Mac epoch (2001-01-01) is day 0", () => {
    const epoch = new Date("2001-01-01T00:00:00Z");
    expect(dateToSrsEpochDays(epoch)).toBe(0);
  });

  test("round-trips accurately", () => {
    const now = new Date();
    const days = dateToSrsEpochDays(now);
    const back = srsEpochDaysToDate(days);
    expect(Math.abs(back.getTime() - now.getTime())).toBeLessThan(1);
  });

  test("one day = 1.0 in epoch days", () => {
    const d1 = new Date("2025-06-15T00:00:00Z");
    const d2 = new Date("2025-06-16T00:00:00Z");
    expect(dateToSrsEpochDays(d2) - dateToSrsEpochDays(d1)).toBeCloseTo(1.0, 10);
  });
});

// ─── Due date helpers ───

describe("getSimpleDueDate / isSimpleDue", () => {
  const makeCard = (simpleN: number | null): SrsCardRow => ({ simpleN }) as SrsCardRow;

  test("returns null for card with no simpleN", () => {
    expect(getSimpleDueDate(makeCard(null))).toBeNull();
  });

  test("returns correct date for simpleN", () => {
    const days = dateToSrsEpochDays(new Date("2025-03-08T12:00:00Z"));
    const card = makeCard(days);
    const due = getSimpleDueDate(card)!;
    expect(due.toISOString()).toBe("2025-03-08T12:00:00.000Z");
  });

  test("card with n=0 is always due (Mac epoch is in the past)", () => {
    expect(isSimpleDue(makeCard(0))).toBe(true);
  });

  test("card with null simpleN is not due", () => {
    expect(isSimpleDue(makeCard(null))).toBe(false);
  });

  test("card in the far future is not due", () => {
    const future = dateToSrsEpochDays(new Date("2099-01-01T00:00:00Z"));
    expect(isSimpleDue(makeCard(future))).toBe(false);
  });
});

// ─── End of logical day ───

describe("getEndOfLogicalDay", () => {
  test("after reset hour: cutoff is resetHour tomorrow", () => {
    const now = new Date(2025, 2, 8, 14, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(9);
    expect(cutoff.getHours()).toBe(3);
    expect(cutoff.getMinutes()).toBe(0);
  });

  test("before reset hour: cutoff is resetHour today", () => {
    const now = new Date(2025, 2, 8, 1, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(8);
    expect(cutoff.getHours()).toBe(3);
  });

  test("exactly at reset hour: cutoff is resetHour tomorrow", () => {
    const now = new Date(2025, 2, 8, 3, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(9);
    expect(cutoff.getHours()).toBe(3);
  });

  test("resetHour=0 (midnight): cutoff is midnight tomorrow", () => {
    const now = new Date(2025, 2, 8, 15, 0, 0);
    const cutoff = getEndOfLogicalDay(0, now);
    expect(cutoff.getDate()).toBe(9);
    expect(cutoff.getHours()).toBe(0);
  });

  test("cutoff is always in the future", () => {
    const now = new Date();
    for (const resetHour of [0, 1, 2, 3, 4, 5, 6]) {
      const cutoff = getEndOfLogicalDay(resetHour, now);
      expect(cutoff.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  test("handles month boundary", () => {
    const now = new Date(2025, 2, 31, 22, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getMonth()).toBe(3); // April
    expect(cutoff.getDate()).toBe(1);
    expect(cutoff.getHours()).toBe(3);
  });

  test("handles year boundary", () => {
    const now = new Date(2025, 11, 31, 22, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(0);
    expect(cutoff.getDate()).toBe(1);
  });
});

describe("endOfLogicalDayEpochDays", () => {
  test("returns a value greater than dateToSrsEpochDays(now)", () => {
    const now = new Date(2025, 2, 8, 14, 0, 0);
    const cutoff = endOfLogicalDayEpochDays(3, now);
    const nowDays = dateToSrsEpochDays(now);
    expect(cutoff).toBeGreaterThan(nowDays);
  });

  test("card due at 11pm tonight is within cutoff when resetHour=3", () => {
    const now = new Date(2025, 2, 8, 9, 0, 0);
    const cutoff = endOfLogicalDayEpochDays(3, now);
    const cardDue = dateToSrsEpochDays(new Date(2025, 2, 8, 23, 0, 0));
    expect(cardDue).toBeLessThan(cutoff);
  });

  test("card due at 4am tomorrow is NOT within cutoff when resetHour=3", () => {
    const now = new Date(2025, 2, 8, 9, 0, 0);
    const cutoff = endOfLogicalDayEpochDays(3, now);
    const cardDue = dateToSrsEpochDays(new Date(2025, 2, 9, 4, 0, 0));
    expect(cardDue).toBeGreaterThan(cutoff);
  });
});

describe("endOfLogicalDayISO", () => {
  test("returns a valid ISO string", () => {
    const iso = endOfLogicalDayISO(3, new Date(2025, 2, 8, 14, 0, 0));
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  test("ISO cutoff matches epoch-day cutoff", () => {
    const now = new Date(2025, 2, 8, 14, 0, 0);
    const isoCutoff = new Date(endOfLogicalDayISO(3, now));
    const epochCutoff = srsEpochDaysToDate(endOfLogicalDayEpochDays(3, now));
    expect(Math.abs(isoCutoff.getTime() - epochCutoff.getTime())).toBeLessThan(1);
  });
});

// ─── SRS algorithm ───

describe("simpleInitCard", () => {
  test("initializes as learning, immediately due, with 1/3 day interval", () => {
    const card = simpleInitCard();
    expect(card.simpleStage).toBe(0);
    expect(card.simpleN).toBe(0);
    expect(card.simpleInterval).toBeCloseTo(1 / 3, 4);
  });
});

describe("SIMPLE_SRS_REQUIRED_CORRECT", () => {
  test("requires 3 correct answers to graduate", () => {
    expect(SIMPLE_SRS_REQUIRED_CORRECT).toBe(3);
  });
});

describe("simpleReviewFail", () => {
  test("resets to learning, n=0, preserves interval", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const result = simpleReviewFail(card);
    expect(result.simpleStage).toBe(0);
    expect(result.simpleN).toBe(0);
    expect(result.simpleInterval).toBe(10);
  });

  test("uses initial interval (1/3) if card has no interval", () => {
    const card = {} as SrsCardRow;
    const result = simpleReviewFail(card);
    expect(result.simpleInterval).toBeCloseTo(1 / 3, 4);
  });
});

describe("simpleGraduate", () => {
  // ─── Normal graduation (never lapsed) ───

  test("correct: interval × 1.9", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleStage).toBe(1);
    expect(result.simpleInterval).toBeCloseTo(19, 1);
  });

  test("easy: interval × 2.6125 (1.9 × 1.375)", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const result = simpleGraduate(card, true, false);
    expect(result.simpleInterval).toBeCloseTo(26.125, 2);
  });

  test("due date is now + interval", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const before = dateToSrsEpochDays();
    const result = simpleGraduate(card, false, false);
    const after = dateToSrsEpochDays();
    expect(result.simpleN).toBeGreaterThanOrEqual(before + 19 - 0.1);
    expect(result.simpleN).toBeLessThanOrEqual(after + 19 + 0.1);
  });

  // ─── Verified interval chains ───

  test("correct chain matches the expected interval progression", () => {
    // Starting from initial interval 1/3, each graduation multiplies by 1.9
    const expectedChain = [
      0.6333, 1.2033, 2.2863, 4.344, 8.2536, 15.6819, 29.7956, 56.6116, 107.5621, 204.368, 365,
    ];
    let interval = 1 / 3;
    for (const expected of expectedChain) {
      const card = { simpleInterval: interval } as SrsCardRow;
      const result = simpleGraduate(card, false, false);
      expect(result.simpleInterval).toBeCloseTo(expected, 2);
      interval = result.simpleInterval;
    }
  });

  test("correct chain caps at 365 and stays there", () => {
    const card = { simpleInterval: 365 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleInterval).toBe(365);
  });

  // ─── Re-graduation after lapse ───

  test("lapse: interval × 0.5", () => {
    const card = { simpleInterval: 20 } as SrsCardRow;
    const result = simpleGraduate(card, false, true);
    expect(result.simpleInterval).toBeCloseTo(10, 1);
  });

  test("lapse chain halves the interval as expected", () => {
    for (const [before, after] of [
      [41.15, 20.575],
      [78.19, 39.095],
      [148.57, 74.285],
    ]) {
      const card = { simpleInterval: before } as SrsCardRow;
      const result = simpleGraduate(card, false, true);
      expect(result.simpleInterval).toBeCloseTo(after, 2);
    }
  });

  test("lapse ignores easy flag (always halves)", () => {
    const card = { simpleInterval: 20 } as SrsCardRow;
    const result = simpleGraduate(card, true, true);
    expect(result.simpleInterval).toBeCloseTo(10, 1);
  });

  // ─── Clamping ───

  test("interval clamped to 365 max", () => {
    const card = { simpleInterval: 300 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleInterval).toBe(365); // 300 × 1.9 = 570 → clamped
  });

  test("interval clamped to 1/3 min", () => {
    const card = { simpleInterval: 0.01 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleInterval).toBeCloseTo(1 / 3, 4);
  });

  test("lapse re-graduation clamps to 365 max", () => {
    const card = { simpleInterval: 365 } as SrsCardRow;
    const result = simpleGraduate(card, false, true);
    expect(result.simpleInterval).toBeCloseTo(182.5, 1); // 365 × 0.5
  });

  test("lapse with tiny interval clamps to 1/3 min", () => {
    const card = { simpleInterval: 0.1 } as SrsCardRow;
    const result = simpleGraduate(card, false, true);
    expect(result.simpleInterval).toBeCloseTo(1 / 3, 4); // 0.1 × 0.5 = 0.05 → clamped
  });

  // ─── Null/missing interval fallback ───

  test("uses initial interval (1/3) when card has no interval", () => {
    const card = {} as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleInterval).toBeCloseTo((1 / 3) * 1.9, 4);
  });

  // ─── Always sets stage to 1 ───

  test("always graduates to stage 1", () => {
    const card = { simpleInterval: 5 } as SrsCardRow;
    expect(simpleGraduate(card, false, false).simpleStage).toBe(1);
    expect(simpleGraduate(card, true, false).simpleStage).toBe(1);
    expect(simpleGraduate(card, false, true).simpleStage).toBe(1);
    expect(simpleGraduate(card, true, true).simpleStage).toBe(1);
  });
});

// ─── Full session flow simulation ───

describe("session flow", () => {
  test("new card → 3 correct → graduates with initial interval × 1.9", () => {
    // First time: simpleInitCard
    const init = simpleInitCard();
    expect(init.simpleStage).toBe(0);
    expect(init.simpleInterval).toBeCloseTo(1 / 3, 4);

    // After 3 correct: graduate
    const card = { simpleInterval: init.simpleInterval } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleStage).toBe(1);
    expect(result.simpleInterval).toBeCloseTo((1 / 3) * 1.9, 4); // ~0.633
  });

  test("graduated card fails → lapse → 3 correct → re-graduates at half interval", () => {
    // Start with a graduated card at interval 20
    const graduated = { simpleInterval: 20, simpleStage: 1 } as SrsCardRow;

    // Fail: preserves interval, resets to learning
    const failed = simpleReviewFail(graduated);
    expect(failed.simpleStage).toBe(0);
    expect(failed.simpleInterval).toBe(20);

    // Re-graduate after lapse: interval halved
    const regrad = simpleGraduate({ ...graduated, ...failed } as SrsCardRow, false, true);
    expect(regrad.simpleStage).toBe(1);
    expect(regrad.simpleInterval).toBeCloseTo(10, 1); // 20 × 0.5
  });

  test("easy skips learning, uses easy multiplier", () => {
    const init = simpleInitCard();
    const card = { simpleInterval: init.simpleInterval } as SrsCardRow;
    const result = simpleGraduate(card, true, false);
    expect(result.simpleStage).toBe(1);
    expect(result.simpleInterval).toBeCloseTo((1 / 3) * 2.6125, 4); // ~0.871
  });

  test("graduated card due for review: pass once → new interval × 1.9", () => {
    const card = { simpleInterval: 10, simpleStage: 1, lapses: 0 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleInterval).toBeCloseTo(19, 1);
    expect(result.simpleStage).toBe(1);
  });
});

/**
 * The lapse multiplier belongs to the lapse, not to the card's history.
 *
 * It was scoped to `lapses > 0` — a lifetime counter nothing resets — so every
 * graduation after a card's first ever failure halved the interval instead of
 * multiplying it. A card climbed to 56 days, failed once, and then ratcheted
 * 28 → 14 → 7 → 3.5 → … → the 8-hour floor, where it stayed due daily forever.
 * Side by side with Midori on the same list, Midori's queue decayed and this
 * one did not.
 */
describe("the lapse multiplier is scoped to the lapse", () => {
  // `lapses: 3` is the whole point: this card HAS failed before. Under the old
  // scoping that alone forced the halving, which is what these pin.
  const card = (over: Partial<SrsCardRow> = {}): SrsCardRow =>
    ({
      simpleStage: 1,
      simpleN: 0,
      simpleInterval: 56.61,
      simpleRelearning: 0,
      lapses: 3,
      ...over,
    }) as SrsCardRow;

  test("a pass while relearning halves once", () => {
    expect(simpleGraduate(card({ simpleRelearning: 1 }), false, true).simpleInterval).toBeCloseTo(
      28.305,
      3,
    );
  });

  test("and clears the flag, so the next pass multiplies again", () => {
    const first = simpleGraduate(card({ simpleRelearning: 1 }), false, true);
    expect(first.simpleRelearning).toBe(0);
    const second = simpleGraduate(card({ simpleInterval: first.simpleInterval }), false, false);
    expect(second.simpleInterval).toBeCloseTo(28.305 * 1.9, 3);
  });

  test("a card that has lapsed in the past but is not relearning grows", () => {
    expect(simpleGraduate(card(), false, false).simpleInterval).toBeCloseTo(56.61 * 1.9, 2);
  });

  test("ten passes after one lapse end far above the floor, not on it", () => {
    let c = card({ simpleInterval: 56.61, simpleRelearning: 1 });
    let relearning = true;
    for (let i = 0; i < 10; i++) {
      const u = simpleGraduate(c, false, relearning);
      relearning = u.simpleRelearning === 1;
      c = card({ simpleInterval: u.simpleInterval, simpleRelearning: u.simpleRelearning });
    }
    expect(c.simpleInterval).toBeGreaterThan(100);
  });

  test("a fail marks the card as relearning", () => {
    expect(simpleReviewFail(card()).simpleRelearning).toBe(1);
  });

  test("a new card is not relearning", () => {
    expect(simpleInitCard().simpleRelearning).toBe(0);
  });
});

/**
 * The wiring, not the arithmetic.
 *
 * The lapse bug lived in which flag the study screen handed to simpleGraduate,
 * and every test above calls simpleGraduate directly — so all of them stayed
 * green with the screen still passing `lapses > 0`. These drive the whole
 * answer the way the screen does.
 */
describe("one answer, decided the way the screen decides it", () => {
  const graduated = (over: Partial<SrsCardRow> = {}): SrsCardRow =>
    ({
      simpleStage: 1,
      simpleN: 0,
      simpleInterval: 56.61,
      simpleRelearning: 0,
      lapses: 3,
      ...over,
    }) as SrsCardRow;

  test("fail → three passes → the card recovers instead of ratcheting", () => {
    let card = graduated();

    const fail = nextSimpleReview(card, "fail");
    expect(fail.graduated).toBe(false);
    expect(fail.updates.simpleRelearning).toBe(1);
    card = { ...card, ...fail.updates };

    for (let i = 0; i < 2; i++) {
      const step = nextSimpleReview(card, "pass");
      expect(step.graduated).toBe(false);
      // The lapse is still being served, so the flag has to survive the re-queue.
      expect(step.updates.simpleRelearning).toBe(1);
      card = { ...card, ...step.updates };
    }

    const third = nextSimpleReview(card, "pass");
    expect(third.graduated).toBe(true);
    expect(third.updates.simpleInterval).toBeCloseTo(28.305, 3); // halved ONCE
    expect(third.updates.simpleRelearning).toBe(0);
    card = { ...card, ...third.updates };

    // And the next review grows again — this is the whole fix.
    const after = nextSimpleReview(card, "pass");
    expect(after.updates.simpleInterval).toBeCloseTo(28.305 * 1.9, 3);
  });

  test("a card that failed long ago but is not relearning grows", () => {
    const step = nextSimpleReview(graduated(), "pass");
    expect(step.updates.simpleInterval).toBeCloseTo(56.61 * 1.9, 2);
  });

  test("easy graduates at once and still halves only inside a lapse", () => {
    expect(
      nextSimpleReview(graduated({ simpleRelearning: 1 }), "easy").updates.simpleInterval,
    ).toBeCloseTo(28.305, 3);
    expect(nextSimpleReview(graduated(), "easy").updates.simpleInterval).toBeCloseTo(
      56.61 * 2.6125,
      2,
    );
  });

  test("a new card counts up to three, then graduates", () => {
    const fresh = {
      simpleStage: null,
      simpleInterval: null,
      simpleRelearning: 0,
      lapses: 0,
    } as SrsCardRow;
    const first = nextSimpleReview(fresh, "pass");
    expect(first.graduated).toBe(false);
    expect(first.updates.simpleRun).toBe(1);
    const once = { ...fresh, ...first.updates };
    const second = nextSimpleReview(once, "pass");
    expect(second.updates.simpleRun).toBe(2);
    expect(nextSimpleReview({ ...once, ...second.updates }, "pass").graduated).toBe(true);
  });

  test("a graduated card due for review settles in one pass", () => {
    expect(nextSimpleReview(graduated(), "pass").graduated).toBe(true);
  });
});

describe("the stage domain", () => {
  test("writes only 0 and 1, which every consumer keys on", () => {
    // `db/simple-queue.ts`, `DueCardsSection`, the lists index, `stores/lists.ts`
    // and `lib/practice-stats.ts` all treat stage 1 as graduated and 0 as
    // learning. A third value would be served by some and counted by none, so
    // the invariant is pinned where it is produced.
    const stages = new Set<number>();
    const seen: SrsCardRow[] = [
      { simpleStage: null, simpleN: null, simpleInterval: null, simpleRelearning: 0, simpleRun: 0 },
      { simpleStage: 0, simpleN: 0, simpleInterval: 1 / 3, simpleRelearning: 0, simpleRun: 0 },
      { simpleStage: 0, simpleN: 0, simpleInterval: 1 / 3, simpleRelearning: 1, simpleRun: 2 },
      { simpleStage: 1, simpleN: 9000, simpleInterval: 56.61, simpleRelearning: 0, simpleRun: 0 },
    ] as unknown as SrsCardRow[];
    for (const card of seen) {
      for (const action of ["pass", "easy", "fail"] as const) {
        stages.add(nextSimpleReview(card, action).updates.simpleStage);
      }
    }
    expect([...stages].sort()).toEqual([0, 1]);
  });
});
