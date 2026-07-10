import { createClerkClient } from "@clerk/backend";

import { ApiError } from "./auth";

export type ApiQuotaEndpoint = "reader_sentence_explain" | "word_example_sentences";
export type ApiQuotaBucket = "ai";

const METADATA_KEY = "jitenApiUsage";
const DEFAULT_DAILY_LIMITS: Record<ApiQuotaBucket, number> = {
  ai: 100,
};
const AI_ENDPOINT_COSTS: Record<ApiQuotaEndpoint, number> = {
  reader_sentence_explain: 2,
  word_example_sentences: 1,
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
    const user = await client.users.getUser(userId);
    const currentMetadata = user.privateMetadata ?? {};
    const usage = readStoredApiUsage(currentMetadata);
    const { nextUsage, result } = incrementDailyUsage({ usage, bucket, day, limit, cost });

    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        ...currentMetadata,
        [METADATA_KEY]: nextUsage,
      },
    });

    return result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("[api-rate-limit] Could not update quota:", err);
    throw new ApiError(503, "Could not verify usage quota");
  }
}

export function setRateLimitHeaders(
  res: { setHeader(name: string, value: string | number): void },
  quota: DailyQuotaResult,
): void {
  res.setHeader("X-RateLimit-Limit", quota.limit);
  res.setHeader("X-RateLimit-Remaining", quota.remaining);
  res.setHeader("X-RateLimit-Reset", quota.resetAt);
  res.setHeader("X-RateLimit-Cost", quota.cost);
}

// Transport-free variant for the Hono middleware: the same four headers as
// string values to hand to c.header().
export function rateLimitHeaders(quota: DailyQuotaResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(quota.limit),
    "X-RateLimit-Remaining": String(quota.remaining),
    "X-RateLimit-Reset": String(quota.resetAt),
    "X-RateLimit-Cost": String(quota.cost),
  };
}
