import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "./auth";
import {
  getDailyResetEpochSeconds,
  getUtcDay,
  incrementDailyUsage,
  parseDailyLimit,
  readStoredApiUsage,
} from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API rate limits", () => {
  test("uses UTC days and computes the next reset timestamp", () => {
    expect(getUtcDay(new Date("2026-05-01T23:59:59.000Z"))).toBe("2026-05-01");
    expect(getDailyResetEpochSeconds("2026-05-01")).toBe(Date.UTC(2026, 4, 2) / 1000);
  });

  test("parses stored Clerk private metadata defensively", () => {
    expect(
      readStoredApiUsage({
        jitenApiUsage: {
          reader_sentence_explain: { day: "2026-05-01", count: 12.8 },
          ignored: { day: "2026-05-01", count: 99 },
        },
      }),
    ).toEqual({
      reader_sentence_explain: { day: "2026-05-01", count: 12 },
    });
  });

  test("increments current-day usage and resets stale days", () => {
    const stale = incrementDailyUsage({
      usage: { reader_sentence_explain: { day: "2026-04-30", count: 50 } },
      feature: "reader_sentence_explain",
      day: "2026-05-01",
      limit: 50,
    });
    expect(stale.nextUsage.reader_sentence_explain).toEqual({ day: "2026-05-01", count: 1 });
    expect(stale.result.remaining).toBe(49);

    const current = incrementDailyUsage({
      usage: { reader_sentence_explain: { day: "2026-05-01", count: 49 } },
      feature: "reader_sentence_explain",
      day: "2026-05-01",
      limit: 50,
    });
    expect(current.nextUsage.reader_sentence_explain).toEqual({ day: "2026-05-01", count: 50 });
    expect(current.result.remaining).toBe(0);
  });

  test("rejects usage after the daily limit", () => {
    expect(() =>
      incrementDailyUsage({
        usage: { reader_sentence_explain: { day: "2026-05-01", count: 50 } },
        feature: "reader_sentence_explain",
        day: "2026-05-01",
        limit: 50,
      }),
    ).toThrow(ApiError);
  });

  test("allows the daily limit to be configured by environment", () => {
    vi.stubEnv("READER_EXPLAIN_DAILY_LIMIT", "7");
    expect(parseDailyLimit("reader_sentence_explain")).toBe(7);

    vi.stubEnv("READER_EXPLAIN_DAILY_LIMIT", "invalid");
    expect(parseDailyLimit("reader_sentence_explain")).toBe(50);
  });
});
