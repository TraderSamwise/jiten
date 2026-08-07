import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const libsqlMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@libsql/client/web", () => ({
  createClient: libsqlMocks.createClient.mockImplementation(() => ({
    execute: libsqlMocks.execute,
    batch: libsqlMocks.batch,
  })),
}));

const { ApiError } = await import("./auth");
const {
  consumeDailyUserQuota,
  consumeGlobalDailyQuota,
  getDailyResetEpochSeconds,
  getEndpointCost,
  getQuotaBucket,
  getUtcDay,
  GlobalQuotaExceededError,
  isQuotaDbConfigured,
  parseDailyLimit,
  parseGlobalDailyLimit,
  QuotaExceededError,
  resetQuotaState,
} = await import("./rate-limit");

/** Finds the counter upsert, ignoring the fire-and-forget prune of stale rows. */
function counterStatement() {
  const call = libsqlMocks.execute.mock.calls.find((c) =>
    String(c[0]?.sql).includes("INSERT INTO"),
  );
  if (!call) throw new Error("no counter statement was executed");
  return call[0];
}

/** The counter statement returns the new total via RETURNING; no rows means refused. */
function mockCounter(newTotal: number | null) {
  libsqlMocks.batch.mockResolvedValue([]);
  libsqlMocks.execute.mockResolvedValue({
    rows: newTotal === null ? [] : [{ count: newTotal }],
    rowsAffected: newTotal === null ? 0 : 1,
  });
}

beforeEach(() => {
  resetQuotaState();
  libsqlMocks.execute.mockReset();
  libsqlMocks.batch.mockReset();
  vi.stubEnv("TURSO_QUOTA_DB_URL", "libsql://quota.turso.io");
  vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("quota configuration", () => {
  test("uses UTC days and computes the next reset timestamp", () => {
    expect(getUtcDay(new Date("2026-05-01T23:59:59.000Z"))).toBe("2026-05-01");
    expect(getDailyResetEpochSeconds("2026-05-01")).toBe(Date.UTC(2026, 4, 2) / 1000);
  });

  test("maps AI endpoints to a shared weighted quota bucket", () => {
    expect(getQuotaBucket("reader_sentence_explain")).toBe("ai");
    expect(getQuotaBucket("word_context_sentences")).toBe("ai");
    expect(getQuotaBucket("word_fill_blank")).toBe("ai");
    expect(getEndpointCost("reader_sentence_explain")).toBe(2);
    expect(getEndpointCost("word_example_sentences")).toBe(1);
    expect(getEndpointCost("word_fill_blank")).toBe(2);
  });

  test("reads both limits from the environment, falling back on nonsense", () => {
    vi.stubEnv("AI_DAILY_QUOTA", "7");
    expect(parseDailyLimit("ai")).toBe(7);
    vi.stubEnv("AI_DAILY_QUOTA", "invalid");
    expect(parseDailyLimit("ai")).toBe(500);

    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "5000");
    expect(parseGlobalDailyLimit()).toBe(5000);
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "0");
    expect(parseGlobalDailyLimit()).toBe(2000);
  });

  test("requires both the URL and the token", () => {
    expect(isQuotaDbConfigured()).toBe(true);
    vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "");
    expect(isQuotaDbConfigured()).toBe(false);
  });
});

describe("consumeDailyUserQuota", () => {
  test("charges the endpoint cost and reports what is left", async () => {
    mockCounter(12);
    const result = await consumeDailyUserQuota("user_1", "reader_sentence_explain");

    expect(result).toEqual({
      limit: 500,
      remaining: 488,
      resetAt: getDailyResetEpochSeconds(getUtcDay()),
      cost: 2,
    });
  });

  test("increments and checks the limit in a single statement, keyed by user and day", async () => {
    mockCounter(1);
    await consumeDailyUserQuota("user_1", "word_example_sentences");

    const stmt = counterStatement();
    // One statement: a read-then-write would let two concurrent requests both pass
    expect(stmt.sql).toMatch(/ON CONFLICT\(user_id, day\) DO UPDATE/);
    expect(stmt.sql).toMatch(/WHERE count \+ :cost <= :limit/);
    expect(stmt.sql).toMatch(/RETURNING count/);
    expect(stmt.args).toMatchObject({ userId: "user_1", cost: 1, limit: 500 });
  });

  test("refuses once the day is full", async () => {
    mockCounter(null);
    const error = await consumeDailyUserQuota("user_1", "kanji_mnemonic").catch((e) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error.status).toBe(429);
    expect(error.quota).toMatchObject({ limit: 500, remaining: 0, cost: 1 });
  });

  test("refuses a request that could not fit in an empty day", async () => {
    vi.stubEnv("AI_DAILY_QUOTA", "1");
    await expect(consumeDailyUserQuota("user_1", "reader_sentence_explain")).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });

  test("fails closed when the counter cannot be reached", async () => {
    libsqlMocks.batch.mockResolvedValue([]);
    libsqlMocks.execute.mockRejectedValue(new Error("network down"));

    const error = await consumeDailyUserQuota("user_1", "kanji_mnemonic").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(QuotaExceededError);
    expect(error.status).toBe(503);
  });

  test("skips enforcement when the counter is not configured", async () => {
    vi.stubEnv("TURSO_QUOTA_DB_URL", "");
    const result = await consumeDailyUserQuota("user_1", "kanji_mnemonic");

    expect(result.limit).toBe(500);
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });
});

describe("consumeGlobalDailyQuota", () => {
  test("records usage and reports the running total", async () => {
    mockCounter(42);
    const result = await consumeGlobalDailyQuota(2);

    expect(result).toMatchObject({ limit: 2000, used: 42 });
    expect(result!.resetAt).toBeGreaterThan(0);
  });

  test("increments and checks the limit in a single statement", async () => {
    mockCounter(2);
    await consumeGlobalDailyQuota(2);

    const stmt = counterStatement();
    expect(stmt.sql).toMatch(/ON CONFLICT\(day\) DO UPDATE/);
    expect(stmt.sql).toMatch(/WHERE count \+ :cost <= :limit/);
    expect(stmt.sql).toMatch(/RETURNING count/);
    expect(stmt.args).toMatchObject({ cost: 2, limit: 2000 });
  });

  test("refuses once the service-wide day is full", async () => {
    mockCounter(null);
    const error = await consumeGlobalDailyQuota(2).catch((e) => e);

    expect(error).toBeInstanceOf(GlobalQuotaExceededError);
    expect(error.status).toBe(429);
    expect(error.limit).toBe(2000);
  });

  test("refuses a single request larger than the whole daily budget", async () => {
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "1");
    await expect(consumeGlobalDailyQuota(5)).rejects.toBeInstanceOf(GlobalQuotaExceededError);
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });

  test("fails closed when the counter cannot be reached", async () => {
    libsqlMocks.batch.mockResolvedValue([]);
    libsqlMocks.execute.mockRejectedValue(new Error("network down"));

    const error = await consumeGlobalDailyQuota(1).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(GlobalQuotaExceededError);
    expect(error.status).toBe(503);
  });

  test("skips enforcement when the counter is not configured", async () => {
    vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "");
    await expect(consumeGlobalDailyQuota(2)).resolves.toBeNull();
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });
});

describe("shared counter database", () => {
  test("creates both tables once per process, not per request", async () => {
    mockCounter(1);
    await consumeDailyUserQuota("user_1", "kanji_mnemonic");
    await consumeGlobalDailyQuota(1);

    expect(libsqlMocks.batch).toHaveBeenCalledTimes(1);
    const [statements] = libsqlMocks.batch.mock.calls[0];
    expect(statements.join(" ")).toMatch(/ai_global_usage/);
    expect(statements.join(" ")).toMatch(/ai_user_usage/);
  });
});
