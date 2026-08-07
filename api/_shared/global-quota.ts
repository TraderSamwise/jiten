// The /web entry keeps the Vercel function free of libsql's native bindings —
// same choice as db/turso-client.ts.
import { createClient, type Client } from "@libsql/client/web";

import { ApiError } from "./auth";
import { getDailyResetEpochSeconds, getUtcDay } from "./rate-limit";

// A service-wide ceiling on AI spend, on top of the per-user daily quota. Per-user
// counters live in each user's Clerk metadata and can't see each other, so nothing
// there bounds the total: N accounts cost N x their limit. This bounds the sum.
const DEFAULT_GLOBAL_DAILY_LIMIT = 2000;
const MAX_GLOBAL_DAILY_LIMIT = 1_000_000;
const TABLE = "ai_global_usage";
const TIMEOUT_MS = 5_000;

export class GlobalQuotaExceededError extends ApiError {
  readonly name = "GlobalQuotaExceededError";

  constructor(
    readonly limit: number,
    readonly resetAt: number,
  ) {
    super(429, "Jiten's shared daily AI limit has been reached.");
  }
}

export function parseGlobalDailyLimit(): number {
  const raw = process.env.AI_GLOBAL_DAILY_QUOTA;
  if (!raw) return DEFAULT_GLOBAL_DAILY_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_GLOBAL_DAILY_LIMIT;
  return Math.min(Math.floor(parsed), MAX_GLOBAL_DAILY_LIMIT);
}

/** Enforcement is inert until the shared counter database is configured. */
export function isGlobalQuotaConfigured(): boolean {
  return !!(process.env.TURSO_QUOTA_DB_URL && process.env.TURSO_QUOTA_DB_TOKEN);
}

let client: Client | null = null;
let tableReady = false;
let warnedUnconfigured = false;

function getClient(): Client {
  client ??= createClient({
    url: process.env.TURSO_QUOTA_DB_URL!,
    authToken: process.env.TURSO_QUOTA_DB_TOKEN!,
  });
  return client;
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`global quota ${label} timed out`)), TIMEOUT_MS),
    ),
  ]);
}

async function ensureTable(db: Client): Promise<void> {
  if (tableReady) return;
  await withTimeout(
    db.execute(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
    ),
    "schema check",
  );
  tableReady = true;
}

export interface GlobalQuotaResult {
  limit: number;
  used: number;
  resetAt: number;
}

/**
 * Add `units` to today's service-wide total, refusing to exceed the limit.
 *
 * The increment and the limit check are ONE conditional statement, so concurrent
 * requests can't both read the same count and both pass — the exact race an
 * abusive client would otherwise ride past the cap. Returns null when the counter
 * isn't configured; throws rather than allowing the call when it can't be reached.
 */
export async function consumeGlobalDailyQuota(units: number): Promise<GlobalQuotaResult | null> {
  if (!isGlobalQuotaConfigured()) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[global-quota] TURSO_QUOTA_DB_URL/TURSO_QUOTA_DB_TOKEN unset — service-wide AI limit is NOT enforced",
      );
    }
    return null;
  }

  const day = getUtcDay();
  const limit = parseGlobalDailyLimit();
  const resetAt = getDailyResetEpochSeconds(day);
  const cost = Math.max(1, Math.floor(units));

  // A single request that couldn't fit even in an empty day would otherwise slip
  // through on the INSERT path, which has no conflict clause to gate it.
  if (cost > limit) throw new GlobalQuotaExceededError(limit, resetAt);

  let rowsAffected: number;
  let used = 0;
  try {
    const db = getClient();
    await ensureTable(db);
    const result = await withTimeout(
      db.execute({
        sql: `INSERT INTO ${TABLE} (day, count) VALUES (:day, :cost)
              ON CONFLICT(day) DO UPDATE SET count = count + :cost
              WHERE count + :cost <= :limit`,
        args: { day, cost, limit },
      }),
      "write",
    );
    rowsAffected = result.rowsAffected;

    if (rowsAffected > 0) {
      const row = await withTimeout(
        db.execute({ sql: `SELECT count FROM ${TABLE} WHERE day = :day`, args: { day } }),
        "read-back",
      );
      used = Number(row.rows[0]?.count ?? 0);
    }
  } catch (err) {
    // Fail closed: an unreachable counter must not become an open tap.
    console.error("[global-quota] Could not record usage:", err);
    throw new ApiError(503, "Could not verify service usage limits");
  }

  if (rowsAffected === 0) throw new GlobalQuotaExceededError(limit, resetAt);
  return { limit, used, resetAt };
}

/** Test seam — module-level client/table state would otherwise leak between cases. */
export function resetGlobalQuotaState(): void {
  client = null;
  tableReady = false;
  warnedUnconfigured = false;
}
