import { createClerkClient } from "@clerk/backend";

import { ApiError } from "./auth";

export type ApiQuotaFeature = "reader_sentence_explain";

const METADATA_KEY = "jitenApiUsage";
const DEFAULT_DAILY_LIMITS: Record<ApiQuotaFeature, number> = {
  reader_sentence_explain: 50,
};

interface StoredFeatureUsage {
  day: string;
  count: number;
}

type StoredApiUsage = Partial<Record<ApiQuotaFeature, StoredFeatureUsage>>;

export interface DailyQuotaResult {
  limit: number;
  remaining: number;
  resetAt: number;
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

export function parseDailyLimit(feature: ApiQuotaFeature): number {
  const envName = feature === "reader_sentence_explain" ? "READER_EXPLAIN_DAILY_LIMIT" : undefined;
  const raw = envName ? process.env[envName] : undefined;
  if (!raw) return DEFAULT_DAILY_LIMITS[feature];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAILY_LIMITS[feature];
  return Math.min(Math.floor(parsed), 10_000);
}

export function readStoredApiUsage(metadata: unknown): StoredApiUsage {
  if (!metadata || typeof metadata !== "object") return {};
  const raw = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!raw || typeof raw !== "object") return {};

  const usage: StoredApiUsage = {};
  for (const feature of Object.keys(DEFAULT_DAILY_LIMITS) as ApiQuotaFeature[]) {
    const value = (raw as Record<string, unknown>)[feature];
    if (!value || typeof value !== "object") continue;
    const day = (value as Record<string, unknown>).day;
    const count = (value as Record<string, unknown>).count;
    if (typeof day === "string" && Number.isFinite(count)) {
      usage[feature] = { day, count: Math.max(0, Math.floor(Number(count))) };
    }
  }
  return usage;
}

export function incrementDailyUsage({
  usage,
  feature,
  day,
  limit,
}: {
  usage: StoredApiUsage;
  feature: ApiQuotaFeature;
  day: string;
  limit: number;
}): { nextUsage: StoredApiUsage; result: DailyQuotaResult } {
  const current = usage[feature]?.day === day ? usage[feature]!.count : 0;
  if (current >= limit) {
    throw new ApiError(429, "Daily explain limit reached");
  }

  const nextCount = current + 1;
  return {
    nextUsage: {
      ...usage,
      [feature]: { day, count: nextCount },
    },
    result: {
      limit,
      remaining: Math.max(0, limit - nextCount),
      resetAt: getDailyResetEpochSeconds(day),
    },
  };
}

export async function consumeDailyUserQuota(
  userId: string,
  feature: ApiQuotaFeature,
): Promise<DailyQuotaResult> {
  const client = getClerkClient();
  const day = getUtcDay();
  const limit = parseDailyLimit(feature);

  try {
    const user = await client.users.getUser(userId);
    const currentMetadata = user.privateMetadata ?? {};
    const usage = readStoredApiUsage(currentMetadata);
    const { nextUsage, result } = incrementDailyUsage({ usage, feature, day, limit });

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
}
