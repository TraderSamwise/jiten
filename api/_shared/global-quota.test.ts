import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const libsqlMocks = vi.hoisted(() => ({ execute: vi.fn(), createClient: vi.fn() }));

vi.mock("@libsql/client/web", () => ({
  createClient: libsqlMocks.createClient.mockImplementation(() => ({
    execute: libsqlMocks.execute,
  })),
}));

const { ApiError } = await import("./auth");
const {
  consumeGlobalDailyQuota,
  GlobalQuotaExceededError,
  isGlobalQuotaConfigured,
  parseGlobalDailyLimit,
  resetGlobalQuotaState,
} = await import("./global-quota");

/** CREATE TABLE, then the conditional upsert, then the read-back of the total. */
function mockAcceptedWrite(total: number) {
  libsqlMocks.execute
    .mockResolvedValueOnce({ rowsAffected: 0 })
    .mockResolvedValueOnce({ rowsAffected: 1 })
    .mockResolvedValueOnce({ rows: [{ count: total }] });
}

beforeEach(() => {
  resetGlobalQuotaState();
  libsqlMocks.execute.mockReset();
  vi.stubEnv("TURSO_QUOTA_DB_URL", "libsql://quota.turso.io");
  vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseGlobalDailyLimit", () => {
  test("defaults to 2000", () => {
    expect(parseGlobalDailyLimit()).toBe(2000);
  });

  test("honours AI_GLOBAL_DAILY_QUOTA", () => {
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "5000");
    expect(parseGlobalDailyLimit()).toBe(5000);
  });

  test("falls back on nonsense values rather than disabling the cap", () => {
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "not-a-number");
    expect(parseGlobalDailyLimit()).toBe(2000);
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "0");
    expect(parseGlobalDailyLimit()).toBe(2000);
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "-5");
    expect(parseGlobalDailyLimit()).toBe(2000);
  });
});

describe("isGlobalQuotaConfigured", () => {
  test("requires both the URL and the token", () => {
    expect(isGlobalQuotaConfigured()).toBe(true);
    vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "");
    expect(isGlobalQuotaConfigured()).toBe(false);
  });
});

describe("consumeGlobalDailyQuota", () => {
  test("records usage and reports the running total", async () => {
    mockAcceptedWrite(42);
    const result = await consumeGlobalDailyQuota(2);

    expect(result).toMatchObject({ limit: 2000, used: 42 });
    expect(result!.resetAt).toBeGreaterThan(0);
  });

  test("increments and checks the limit in a single statement", async () => {
    mockAcceptedWrite(2);
    await consumeGlobalDailyQuota(2);

    const upsert = libsqlMocks.execute.mock.calls[1][0];
    // One statement: a read-then-write would let two concurrent callers both pass
    expect(upsert.sql).toMatch(/INSERT INTO/);
    expect(upsert.sql).toMatch(/ON CONFLICT\(day\) DO UPDATE/);
    expect(upsert.sql).toMatch(/WHERE count \+ :cost <= :limit/);
    expect(upsert.args).toMatchObject({ cost: 2, limit: 2000 });
  });

  test("rejects when the statement changed nothing — the day is full", async () => {
    libsqlMocks.execute
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({ rowsAffected: 0 });

    await expect(consumeGlobalDailyQuota(2)).rejects.toBeInstanceOf(GlobalQuotaExceededError);
  });

  test("rejects a single request larger than the whole daily budget", async () => {
    vi.stubEnv("AI_GLOBAL_DAILY_QUOTA", "1");
    // Would otherwise slip through the INSERT path, which has no conflict clause
    await expect(consumeGlobalDailyQuota(5)).rejects.toBeInstanceOf(GlobalQuotaExceededError);
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });

  test("carries the limit and reset time for the client message", async () => {
    libsqlMocks.execute
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({ rowsAffected: 0 });

    const error = await consumeGlobalDailyQuota(1).catch((err) => err);
    expect(error).toBeInstanceOf(GlobalQuotaExceededError);
    expect(error.status).toBe(429);
    expect(error.limit).toBe(2000);
    expect(error.resetAt).toBeGreaterThan(0);
  });

  test("fails closed when the counter cannot be reached", async () => {
    libsqlMocks.execute.mockRejectedValue(new Error("network down"));

    const error = await consumeGlobalDailyQuota(1).catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(GlobalQuotaExceededError);
    expect(error.status).toBe(503);
  });

  test("skips enforcement when the counter is not configured", async () => {
    vi.stubEnv("TURSO_QUOTA_DB_URL", "");
    vi.stubEnv("TURSO_QUOTA_DB_TOKEN", "");

    await expect(consumeGlobalDailyQuota(2)).resolves.toBeNull();
    expect(libsqlMocks.execute).not.toHaveBeenCalled();
  });
});
