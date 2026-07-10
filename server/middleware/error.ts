import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError } from "../../api/_shared/auth";
import { QuotaExceededError, rateLimitHeaders } from "../../api/_shared/rate-limit";

// Central error → response mapping for app.onError. QuotaExceededError extends
// ApiError, so it must be checked first (and carries the rate-limit headers).
export function apiErrorResponse(err: unknown, c: Context) {
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
  // A malformed JSON body surfaces here (zValidator calls c.req.json() before the
  // schema hook runs) — answer 400 with the app's error shape, not a 500.
  if (err instanceof SyntaxError) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  console.error("[api] Unhandled error:", err);
  return c.json({ error: "Internal error" }, 500);
}
