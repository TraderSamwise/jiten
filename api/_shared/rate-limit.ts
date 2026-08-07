// The /web entry keeps the Vercel function free of libsql's native bindings —
// same choice as db/turso-client.ts.
import { createClient, type Client } from "@libsql/client/web";

import { ApiError } from "./auth";

export type ApiQuotaEndpoint =
  | "reader_sentence_explain"
  | "word_example_sentences"
  | "kanji_mnemonic"
  | "word_context_sentences"
  | "word_fill_blank";
export type ApiQuotaBucket = "ai";

const DEFAULT_DAILY_LIMITS: Record<ApiQuotaBucket, number> = {
  // One shared bucket across every AI feature, so it scales with how many of them
  // a session touches — the context game alone spends a couple of units a round.
  ai: 500,
};
const AI_ENDPOINT_COSTS: Record<ApiQuotaEndpoint, number> = {
  reader_sentence_explain: 2,
  word_example_sentences: 1,
  kanji_mnemonic: 1,
  // Charged per batch, not per word: one call covers several words, and a game
  // round fires many of them back to back.
  word_context_sentences: 2,
  word_fill_blank: 2,
};

// A service-wide ceiling on top of the per-user limit. Per-user counters bound
// nothing in aggregate: N accounts cost N x their limit. This bounds the sum.
const DEFAULT_GLOBAL_DAILY_LIMIT = 2000;
const MAX_GLOBAL_DAILY_LIMIT = 1_000_000;

const USER_TABLE = "ai_user_usage";
const GLOBAL_TABLE = "ai_global_usage";
const TIMEOUT_MS = 5_000;

export interface DailyQuotaResult {
  limit: number;
  remaining: number;
  resetAt: number;
  cost: number;
}

export class QuotaExceededError extends ApiError {
  constructor(public readonly quota: DailyQuotaResult) {
    super(429, "Daily AI limit reached");
    this.name = "QuotaExceededError";
  }
}

export class GlobalQuotaExceededError extends ApiError {
  readonly name = "GlobalQuotaExceededError";

  constructor(
    readonly limit: number,
    readonly resetAt: number,
  ) {
    super(429, "Jiten's shared daily AI limit has been reached.");
  }
}

export function getUtcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getDailyResetEpochSeconds(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date + 1) / 1000);
}

export function getQuotaBucket(endpoint: ApiQuotaEndpoint): ApiQuotaBucket {
  switch (endpoint) {
    case "reader_sentence_explain":
    case "word_example_sentences":
    case "kanji_mnemonic":
    case "word_context_sentences":
    case "word_fill_blank":
      return "ai";
  }
}

export function getEndpointCost(endpoint: ApiQuotaEndpoint): number {
  return AI_ENDPOINT_COSTS[endpoint];
}

export function parseDailyLimit(bucket: ApiQuotaBucket): number {
  const envName = bucket === "ai" ? "AI_DAILY_QUOTA" : undefined;
  const raw = envName ? process.env[envName] : undefined;
  if (!raw) return DEFAULT_DAILY_LIMITS[bucket];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAILY_LIMITS[bucket];
  return Math.min(Math.floor(parsed), 10_000);
}

export function parseGlobalDailyLimit(): number {
  const raw = process.env.AI_GLOBAL_DAILY_QUOTA;
  if (!raw) return DEFAULT_GLOBAL_DAILY_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_GLOBAL_DAILY_LIMIT;
  return Math.min(Math.floor(parsed), MAX_GLOBAL_DAILY_LIMIT);
}

/** Enforcement is inert until the counter database is configured. */
export function isQuotaDbConfigured(): boolean {
  return !!(process.env.TURSO_QUOTA_DB_URL && process.env.TURSO_QUOTA_DB_TOKEN);
}

let client: Client | null = null;
let tablesReady = false;
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
      setTimeout(() => reject(new Error(`quota ${label} timed out`)), TIMEOUT_MS),
    ),
  ]);
}

async function ensureTables(db: Client): Promise<void> {
  if (tablesReady) return;
  await withTimeout(
    db.batch(
      [
        `CREATE TABLE IF NOT EXISTS ${GLOBAL_TABLE} (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS ${USER_TABLE} (
           user_id TEXT NOT NULL,
           day TEXT NOT NULL,
           count INTEGER NOT NULL,
           PRIMARY KEY (user_id, day)
         )`,
      ],
      "write",
    ),
    "schema check",
  );
  tablesReady = true;

  // Yesterday's rows are dead weight — counters are per UTC day. Fire and forget
  // once per process so a slow delete never delays a request.
  const cutoff = getUtcDay(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  db.execute({ sql: `DELETE FROM ${USER_TABLE} WHERE day < :cutoff`, args: { cutoff } }).catch(
    (err) => console.warn("[quota] Could not prune old usage rows:", err),
  );
}

function warnUnconfiguredOnce(): void {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  console.warn(
    "[quota] TURSO_QUOTA_DB_URL/TURSO_QUOTA_DB_TOKEN unset — AI usage limits are NOT enforced",
  );
}

/**
 * Charge a user for one request.
 *
 * The increment and the limit test are ONE conditional statement, and `RETURNING`
 * hands back the new total in the same round trip. This counter used to live in
 * Clerk `privateMetadata`, which cost two API calls per request and was a
 * read-modify-write two concurrent requests could ride straight past.
 */
export async function consumeDailyUserQuota(
  userId: string,
  endpoint: ApiQuotaEndpoint,
): Promise<DailyQuotaResult> {
  const day = getUtcDay();
  const bucket = getQuotaBucket(endpoint);
  const limit = parseDailyLimit(bucket);
  const cost = getEndpointCost(endpoint);
  const resetAt = getDailyResetEpochSeconds(day);

  if (!isQuotaDbConfigured()) {
    warnUnconfiguredOnce();
    return { limit, remaining: limit - cost, resetAt, cost };
  }
  if (cost > limit) throw new QuotaExceededError({ limit, remaining: limit, resetAt, cost });

  let applied: number | null;
  try {
    const db = getClient();
    await ensureTables(db);
    const result = await withTimeout(
      db.execute({
        sql: `INSERT INTO ${USER_TABLE} (user_id, day, count) VALUES (:userId, :day, :cost)
              ON CONFLICT(user_id, day) DO UPDATE SET count = count + :cost
              WHERE count + :cost <= :limit
              RETURNING count`,
        args: { userId, day, cost, limit },
      }),
      "user write",
    );
    applied = result.rows.length > 0 ? Number(result.rows[0].count) : null;
  } catch (err) {
    // Fail closed: an unreachable counter must not become an open tap.
    console.error("[quota] Could not record per-user usage:", err);
    throw new ApiError(503, "Could not verify usage quota");
  }

  if (applied === null) {
    throw new QuotaExceededError({ limit, remaining: 0, resetAt, cost });
  }
  return { limit, remaining: Math.max(0, limit - applied), resetAt, cost };
}

export interface GlobalQuotaResult {
  limit: number;
  used: number;
  resetAt: number;
}

/**
 * Add `units` to today's service-wide total, refusing to exceed the limit.
 * Same single-statement guarantee as the per-user counter.
 */
export async function consumeGlobalDailyQuota(units: number): Promise<GlobalQuotaResult | null> {
  if (!isQuotaDbConfigured()) {
    warnUnconfiguredOnce();
    return null;
  }

  const day = getUtcDay();
  const limit = parseGlobalDailyLimit();
  const resetAt = getDailyResetEpochSeconds(day);
  const cost = Math.max(1, Math.floor(units));

  // A single request that couldn't fit even in an empty day would otherwise slip
  // through on the INSERT path, which has no conflict clause to gate it.
  if (cost > limit) throw new GlobalQuotaExceededError(limit, resetAt);

  let used: number | null;
  try {
    const db = getClient();
    await ensureTables(db);
    const result = await withTimeout(
      db.execute({
        sql: `INSERT INTO ${GLOBAL_TABLE} (day, count) VALUES (:day, :cost)
              ON CONFLICT(day) DO UPDATE SET count = count + :cost
              WHERE count + :cost <= :limit
              RETURNING count`,
        args: { day, cost, limit },
      }),
      "global write",
    );
    used = result.rows.length > 0 ? Number(result.rows[0].count) : null;
  } catch (err) {
    console.error("[quota] Could not record service-wide usage:", err);
    throw new ApiError(503, "Could not verify service usage limits");
  }

  if (used === null) throw new GlobalQuotaExceededError(limit, resetAt);
  return { limit, used, resetAt };
}

// The four X-RateLimit-* headers as strings, for the Hono middleware (c.header()).
export function rateLimitHeaders(quota: DailyQuotaResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(quota.limit),
    "X-RateLimit-Remaining": String(quota.remaining),
    "X-RateLimit-Reset": String(quota.resetAt),
    "X-RateLimit-Cost": String(quota.cost),
  };
}

/** Test seam — module-level client/table state would otherwise leak between cases. */
export function resetQuotaState(): void {
  client = null;
  tablesReady = false;
  warnedUnconfigured = false;
}
