import { describe, test, expect } from "vitest";
import { getDayStart, getDayLabel, sqlDayExpr, getLogicalToday } from "./day-boundary";

/** Create a Date from UTC components */
function utc(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min));
}

describe("getDayStart", () => {
  test("returns same calendar day when time is after resetHour", () => {
    const date = utc(2026, 2, 7, 10, 30); // Mar 7, 10:30 UTC
    const result = getDayStart(date, 3);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(2); // March
    expect(result.getUTCDate()).toBe(7);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
  });

  test("returns previous calendar day when time is before resetHour", () => {
    const date = utc(2026, 2, 7, 2, 30); // Mar 7, 2:30 UTC
    const result = getDayStart(date, 3);
    expect(result.getUTCDate()).toBe(6); // Mar 6
    expect(result.getUTCHours()).toBe(0);
  });

  test("returns same day when time equals resetHour exactly", () => {
    const date = utc(2026, 2, 7, 3, 0); // Mar 7, 3:00 UTC
    const result = getDayStart(date, 3);
    expect(result.getUTCDate()).toBe(7);
  });

  test("works with resetHour=0 (midnight boundary)", () => {
    const date = utc(2026, 2, 7, 23, 59);
    const result = getDayStart(date, 0);
    expect(result.getUTCDate()).toBe(7);
  });

  test("handles month boundary rollback", () => {
    const date = utc(2026, 2, 1, 1, 0); // Mar 1, 1:00 UTC
    const result = getDayStart(date, 3);
    expect(result.getUTCMonth()).toBe(1); // Feb
    expect(result.getUTCDate()).toBe(28);
  });

  test("handles year boundary rollback", () => {
    const date = utc(2026, 0, 1, 2, 0); // Jan 1, 2:00 UTC
    const result = getDayStart(date, 3);
    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(11); // Dec
    expect(result.getUTCDate()).toBe(31);
  });

  test("does not mutate input date", () => {
    const date = utc(2026, 2, 7, 2, 30);
    const originalTime = date.getTime();
    getDayStart(date, 3);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe("getDayLabel", () => {
  test("returns YYYY-MM-DD for the logical day", () => {
    const date = utc(2026, 2, 7, 10, 0); // Mar 7, 10:00 UTC
    expect(getDayLabel(date, 3)).toBe("2026-03-07");
  });

  test("returns previous day label when before resetHour", () => {
    const date = utc(2026, 2, 7, 1, 0); // Mar 7, 1:00 UTC
    expect(getDayLabel(date, 3)).toBe("2026-03-06");
  });

  test("returns same day at exactly resetHour", () => {
    const date = utc(2026, 2, 7, 3, 0);
    expect(getDayLabel(date, 3)).toBe("2026-03-07");
  });
});

describe("sqlDayExpr", () => {
  test("returns simple DATE() when resetHour is 0", () => {
    expect(sqlDayExpr("marked_at", 0)).toBe("DATE(marked_at)");
  });

  test("returns datetime offset when resetHour > 0", () => {
    expect(sqlDayExpr("marked_at", 3)).toBe("DATE(datetime(marked_at, '-3 hours'))");
  });

  test("works with different column names", () => {
    expect(sqlDayExpr("reviewed_at", 5)).toBe("DATE(datetime(reviewed_at, '-5 hours'))");
  });
});

describe("getLogicalToday", () => {
  test("returns a YYYY-MM-DD string", () => {
    const result = getLogicalToday(3);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches getDayLabel for current time", () => {
    const now = new Date();
    expect(getLogicalToday(3)).toBe(getDayLabel(now, 3));
  });
});
