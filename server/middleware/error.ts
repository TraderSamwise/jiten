import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError } from "../../api/_shared/auth";
import { GlobalQuotaExceededError } from "../../api/_shared/global-quota";
import { QuotaExceededError, rateLimitHeaders } from "../../api/_shared/rate-limit";

// Central error → response mapping for app.onError. QuotaExceededError extends
// ApiError, so it must be checked first (and carries the rate-limit headers).
export function apiErrorResponse(err: unknown, c: Context) {
  // Distinct code from the per-user quota: the caller has done nothing wrong and
  // has no allowance left to spend, so clients must not present it as their fault.
  if (err instanceof GlobalQuotaExceededError) {
    return c.json(
      { error: err.message, code: "global_quota_exceeded", limit: err.limit, resetAt: err.resetAt },
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof QuotaExceededError) {
    for (const [k, v] of Object.entries(rateLimitHeaders(err.quota))) c.header(k, v);
    return c.json(
      { error: err.message, code: "quota_exceeded", quota: err.quota },
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  // Hono surfaces bad input (e.g. a malformed JSON body, which zValidator rejects
  // via c.req.json()) as an HTTPException — answer with the app's error shape and
  // its status (400) instead of a generic 500.
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[api] Unhandled error:", err);
  return c.json({ error: "Internal error" }, 500);
}
