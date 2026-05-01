import type { VercelResponse } from "@vercel/node";

import { ApiError } from "./auth";
import { QuotaExceededError, setRateLimitHeaders } from "./rate-limit";

export function sendApiError(res: VercelResponse, err: ApiError): VercelResponse {
  if (err instanceof QuotaExceededError) {
    setRateLimitHeaders(res, err.quota);
    return res.status(err.status).json({
      error: err.message,
      code: "quota_exceeded",
      quota: err.quota,
    });
  }

  return res.status(err.status).json({ error: err.message });
}
