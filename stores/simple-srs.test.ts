import { describe, test, expect } from "vitest";
import {
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
    expect(Math.abs(back.getTime() - now.getTime())).toBeLessThan(1); // sub-ms precision
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
    // 2pm on March 8 with resetHour=3 → cutoff is 3am March 9
    const now = new Date(2025, 2, 8, 14, 0, 0); // March 8, 2pm local
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(9);
    expect(cutoff.getHours()).toBe(3);
    expect(cutoff.getMinutes()).toBe(0);
    expect(cutoff.getSeconds()).toBe(0);
  });

  test("before reset hour: cutoff is resetHour today", () => {
    // 1am on March 8 with resetHour=3 → cutoff is 3am March 8
    const now = new Date(2025, 2, 8, 1, 0, 0); // March 8, 1am local
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(8);
    expect(cutoff.getHours()).toBe(3);
  });

  test("exactly at reset hour: cutoff is resetHour tomorrow", () => {
    const now = new Date(2025, 2, 8, 3, 0, 0); // March 8, 3am local
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getDate()).toBe(9);
    expect(cutoff.getHours()).toBe(3);
  });

  test("resetHour=0 (midnight): cutoff is midnight tomorrow", () => {
    const now = new Date(2025, 2, 8, 15, 0, 0); // March 8, 3pm local
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

  test("uses local time (not UTC)", () => {
    // Create a date where local hour differs from UTC hour
    const now = new Date(2025, 2, 8, 14, 0, 0); // 2pm local
    const cutoff = getEndOfLogicalDay(3, now);
    // Cutoff should be in local time, not UTC
    expect(cutoff.getHours()).toBe(3); // local hours, not getUTCHours
  });

  test("handles month boundary", () => {
    // March 31, 10pm with resetHour=3 → cutoff is April 1, 3am
    const now = new Date(2025, 2, 31, 22, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getMonth()).toBe(3); // April (0-indexed)
    expect(cutoff.getDate()).toBe(1);
    expect(cutoff.getHours()).toBe(3);
  });

  test("handles year boundary", () => {
    // Dec 31, 10pm with resetHour=3 → cutoff is Jan 1, 3am
    const now = new Date(2025, 11, 31, 22, 0, 0);
    const cutoff = getEndOfLogicalDay(3, now);
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(0); // January
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
    const now = new Date(2025, 2, 8, 9, 0, 0); // 9am
    const cutoff = endOfLogicalDayEpochDays(3, now);
    // Card due at 11pm tonight
    const cardDue = dateToSrsEpochDays(new Date(2025, 2, 8, 23, 0, 0));
    expect(cardDue).toBeLessThan(cutoff);
  });

  test("card due at 4am tomorrow is NOT within cutoff when resetHour=3", () => {
    const now = new Date(2025, 2, 8, 9, 0, 0); // 9am
    const cutoff = endOfLogicalDayEpochDays(3, now);
    // Card due at 4am tomorrow
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
    const midoriCutoff = srsEpochDaysToDate(endOfLogicalDayEpochDays(3, now));
    expect(Math.abs(isoCutoff.getTime() - midoriCutoff.getTime())).toBeLessThan(1);
  });

  test("FSRS card due at 11pm is before cutoff string", () => {
    const now = new Date(2025, 2, 8, 9, 0, 0);
    const cutoffISO = endOfLogicalDayISO(3, now);
    const cardDueISO = new Date(2025, 2, 8, 23, 0, 0).toISOString();
    // String comparison works for ISO dates
    expect(cardDueISO <= cutoffISO).toBe(true);
  });
});

// ─── SRS algorithm ───

describe("simpleInitCard", () => {
  test("initializes as immediately due in learning", () => {
    const card = simpleInitCard();
    expect(card.simpleStage).toBe(0);
    expect(card.simpleN).toBe(0);
    expect(card.simpleInterval).toBeCloseTo(5 / 6, 4); // ~20 hours
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

  test("uses initial interval if card has no interval", () => {
    const card = {} as SrsCardRow;
    const result = simpleReviewFail(card);
    expect(result.simpleInterval).toBeCloseTo(5 / 6, 4);
  });
});

describe("simpleGraduate", () => {
  test("normal pass: interval × 1.9", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const result = simpleGraduate(card, false, false);
    expect(result.simpleStage).toBe(1);
    expect(result.simpleInterval).toBeCloseTo(19, 1); // 10 × 1.9
    expect(result.simpleN).toBeGreaterThan(0);
  });

  test("easy: interval × 2.9", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const result = simpleGraduate(card, true, false);
    expect(result.simpleInterval).toBeCloseTo(29, 1); // 10 × 2.9
  });

  test("re-graduation after lapse: interval × 0.5, max 6", () => {
    const card = { simpleInterval: 20 } as SrsCardRow;
    const result = simpleGraduate(card, false, true);
    expect(result.simpleInterval).toBe(6); // 20 × 0.5 = 10 → clamped to 6
  });

  test("re-graduation with small interval: halved", () => {
    const card = { simpleInterval: 4 } as SrsCardRow;
    const result = simpleGraduate(card, false, true);
    expect(result.simpleInterval).toBeCloseTo(2, 1); // 4 × 0.5
  });

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

  test("due date is now + interval", () => {
    const card = { simpleInterval: 10 } as SrsCardRow;
    const before = dateToSrsEpochDays();
    const result = simpleGraduate(card, false, false);
    const after = dateToSrsEpochDays();
    // n should be approximately now + 19 days
    expect(result.simpleN).toBeGreaterThanOrEqual(before + 19 - 0.1);
    expect(result.simpleN).toBeLessThanOrEqual(after + 19 + 0.1);
  });
});
