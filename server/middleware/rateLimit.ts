import type { MiddlewareHandler } from "hono";

import {
  consumeDailyUserQuota,
  rateLimitHeaders,
  type ApiQuotaEndpoint,
} from "../../api/_shared/rate-limit";
import type { AppVariables } from "../types";

// Consume the caller's daily quota for an endpoint and emit the X-RateLimit-*
// headers. Runs after authMiddleware (needs userId). A QuotaExceededError thrown
// here is mapped (with headers) by app.onError.
export const rateLimit =
  (endpoint: ApiQuotaEndpoint): MiddlewareHandler<{ Variables: AppVariables }> =>
  async (c, next) => {
    const quota = await consumeDailyUserQuota(c.get("userId"), endpoint);
    for (const [k, v] of Object.entries(rateLimitHeaders(quota))) c.header(k, v);
    await next();
  };
