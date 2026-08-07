import { createClerkClient } from "@clerk/backend";

import { ApiError } from "./auth";

export type ApiQuotaEndpoint =
  | "reader_sentence_explain"
  | "word_example_sentences"
  | "kanji_mnemonic"
  | "word_context_sentences";
export type ApiQuotaBucket = "ai";

const METADATA_KEY = "jitenApiUsage";
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
};

interface StoredFeatureUsage {
  day: string;
  count: number;
}

type StoredApiUsage = Partial<Record<ApiQuotaBucket, StoredFeatureUsage>>;

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

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient(): ReturnType<typeof createClerkClient> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("[api-rate-limit] Missing CLERK_SECRET_KEY");
    throw new ApiError(500, "Server misconfigured");
  }
  clerkClient ??= createClerkClient({ secretKey });
  return clerkClient;
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

export function readStoredApiUsage(metadata: unknown): StoredApiUsage {
  if (!metadata || typeof metadata !== "object") return {};
  const raw = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!raw || typeof raw !== "object") return {};

  const usage: StoredApiUsage = {};
  for (const bucket of Object.keys(DEFAULT_DAILY_LIMITS) as ApiQuotaBucket[]) {
    const value = (raw as Record<string, unknown>)[bucket];
    if (!value || typeof value !== "object") continue;
    const day = (value as Record<string, unknown>).day;
    const count = (value as Record<string, unknown>).count;
    if (typeof day === "string" && Number.isFinite(count)) {
      usage[bucket] = { day, count: Math.max(0, Math.floor(Number(count))) };
    }
  }
  return usage;
}

export function incrementDailyUsage({
  usage,
  bucket,
  day,
  limit,
  cost,
}: {
  usage: StoredApiUsage;
  bucket: ApiQuotaBucket;
  day: string;
  limit: number;
  cost: number;
}): { nextUsage: StoredApiUsage; result: DailyQuotaResult } {
  const current = usage[bucket]?.day === day ? usage[bucket]!.count : 0;
  if (current + cost > limit) {
    throw new QuotaExceededError({
      limit,
      remaining: Math.max(0, limit - current),
      resetAt: getDailyResetEpochSeconds(day),
      cost,
    });
  }

  const nextCount = current + cost;
  return {
    nextUsage: {
      ...usage,
      [bucket]: { day, count: nextCount },
    },
    result: {
      limit,
      remaining: Math.max(0, limit - nextCount),
      resetAt: getDailyResetEpochSeconds(day),
      cost,
    },
  };
}

// This counter lives in Clerk, so every AI request makes two Clerk round trips
// before any work starts. Unbounded, a stalled Clerk call holds the whole request
// until the platform kills it — which is exactly how AI features hung in
// production: a 60s FUNCTION_INVOCATION_TIMEOUT rather than any error.
const CLERK_TIMEOUT_MS = 5_000;

function withClerkTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`clerk ${label} timed out`)), CLERK_TIMEOUT_MS),
    ),
  ]);
}

export async function consumeDailyUserQuota(
  userId: string,
  endpoint: ApiQuotaEndpoint,
): Promise<DailyQuotaResult> {
  const client = getClerkClient();
  const day = getUtcDay();
  const bucket = getQuotaBucket(endpoint);
  const limit = parseDailyLimit(bucket);
  const cost = getEndpointCost(endpoint);

  try {
    const user = await withClerkTimeout(client.users.getUser(userId), "getUser");
    const currentMetadata = user.privateMetadata ?? {};
    const usage = readStoredApiUsage(currentMetadata);
    const { nextUsage, result } = incrementDailyUsage({ usage, bucket, day, limit, cost });

    await withClerkTimeout(
      client.users.updateUserMetadata(userId, {
        privateMetadata: {
          ...currentMetadata,
          [METADATA_KEY]: nextUsage,
        },
      }),
      "updateUserMetadata",
    );

    return result;
  } catch (err) {
    // A real quota rejection still refuses the request.
    if (err instanceof ApiError) throw err;
    // An unreachable counter degrades instead of blocking: the service-wide cap
    // (api/_shared/global-quota.ts) still bounds spend, so per-user accounting is
    // the safer thing to lose. Loud, because it means limits aren't being recorded.
    console.error(`[api-rate-limit] DEGRADED — per-user quota not recorded for ${endpoint}:`, err);
    return { limit, remaining: limit - cost, resetAt: getDailyResetEpochSeconds(day), cost };
  }
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
