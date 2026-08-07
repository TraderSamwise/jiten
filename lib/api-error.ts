interface ApiQuotaPayload {
  limit?: unknown;
  remaining?: unknown;
  resetAt?: unknown;
  cost?: unknown;
}

export function formatQuotaReset(resetAtSeconds: number): string {
  const resetDate = new Date(resetAtSeconds * 1000);
  const resetTime = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(resetDate);
  const timezone = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  })
    .formatToParts(resetDate)
    .find((part) => part.type === "timeZoneName")?.value;

  return timezone ? `${resetTime} ${timezone}` : `${resetTime} local time`;
}

export function getApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const payload = body as Record<string, unknown>;

  if (payload.code === "global_quota_exceeded") {
    const resetAt = Number(payload.resetAt);
    if (Number.isFinite(resetAt) && resetAt > 0) {
      return `Jiten's AI features have hit their shared daily limit. Resets ${formatQuotaReset(resetAt)}.`;
    }
    return "Jiten's AI features have hit their shared daily limit. Try again tomorrow.";
  }

  if (payload.code === "quota_exceeded") {
    const quota = payload.quota as ApiQuotaPayload | undefined;
    const resetAt = Number(quota?.resetAt);
    if (Number.isFinite(resetAt) && resetAt > 0) {
      return `Daily AI quota reached. Resets ${formatQuotaReset(resetAt)}.`;
    }
    return "Daily AI quota reached. Try again tomorrow.";
  }

  return typeof payload.error === "string" ? payload.error : fallback;
}
