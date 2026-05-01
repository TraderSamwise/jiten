import { describe, expect, test } from "vitest";

import { getApiErrorMessage } from "./api-error";

describe("API error formatting", () => {
  test("formats quota errors with reset time", () => {
    const message = getApiErrorMessage(
      {
        error: "Daily AI limit reached",
        code: "quota_exceeded",
        quota: { limit: 100, remaining: 0, resetAt: Date.UTC(2026, 4, 2) / 1000, cost: 2 },
      },
      "fallback",
    );

    expect(message).toContain("Daily AI quota reached.");
    expect(message).toContain("Resets");
    expect(message).toMatch(/(GMT|UTC|[A-Z]{2,5}|local time)/);
  });

  test("falls back to generic API errors", () => {
    expect(getApiErrorMessage({ error: "Nope" }, "fallback")).toBe("Nope");
    expect(getApiErrorMessage(null, "fallback")).toBe("fallback");
  });
});
