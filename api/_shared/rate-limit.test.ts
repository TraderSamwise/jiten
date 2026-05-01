import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "./auth";
import {
  getEndpointCost,
  getQuotaBucket,
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
          ai: { day: "2026-05-01", count: 12.8 },
          ignored: { day: "2026-05-01", count: 99 },
        },
      }),
    ).toEqual({
      ai: { day: "2026-05-01", count: 12 },
    });
  });

  test("maps AI endpoints to a shared weighted quota bucket", () => {
    expect(getQuotaBucket("reader_sentence_explain")).toBe("ai");
    expect(getQuotaBucket("word_example_sentences")).toBe("ai");
    expect(getEndpointCost("reader_sentence_explain")).toBe(2);
    expect(getEndpointCost("word_example_sentences")).toBe(1);
  });

  test("increments current-day usage by cost and resets stale days", () => {
    const stale = incrementDailyUsage({
      usage: { ai: { day: "2026-04-30", count: 50 } },
      bucket: "ai",
      day: "2026-05-01",
      limit: 100,
      cost: 2,
    });
    expect(stale.nextUsage.ai).toEqual({ day: "2026-05-01", count: 2 });
    expect(stale.result.remaining).toBe(98);
    expect(stale.result.cost).toBe(2);

    const current = incrementDailyUsage({
      usage: { ai: { day: "2026-05-01", count: 99 } },
      bucket: "ai",
      day: "2026-05-01",
      limit: 100,
      cost: 1,
    });
    expect(current.nextUsage.ai).toEqual({ day: "2026-05-01", count: 100 });
    expect(current.result.remaining).toBe(0);
  });

  test("rejects usage that would exceed the daily limit", () => {
    expect(() =>
      incrementDailyUsage({
        usage: { ai: { day: "2026-05-01", count: 99 } },
        bucket: "ai",
        day: "2026-05-01",
        limit: 100,
        cost: 2,
      }),
    ).toThrow(ApiError);
  });

  test("allows the daily limit to be configured by environment", () => {
    vi.stubEnv("AI_DAILY_QUOTA", "7");
    expect(parseDailyLimit("ai")).toBe(7);

    vi.stubEnv("AI_DAILY_QUOTA", "invalid");
    expect(parseDailyLimit("ai")).toBe(100);
  });
});
