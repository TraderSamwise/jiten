/**
 * Errors shared by every AI-backed feature. Both are settled outcomes: the quota
 * is already spent by the time either is thrown, so a caller that retries pays
 * twice for the same answer.
 */

/** The daily AI quota is spent — stop generating, don't retry. */
export class AiQuotaError extends Error {
  readonly code = "quota_exceeded";
  readonly name = "AiQuotaError";
}

/** The request was answered, but nothing it returned was usable. */
export class AiUnusableResponseError extends Error {
  readonly code = "unusable_response";
  readonly name = "AiUnusableResponseError";
}

/** True for outcomes that a retry cannot improve. */
export function isSettledAiFailure(err: unknown): boolean {
  return err instanceof AiQuotaError || err instanceof AiUnusableResponseError;
}
