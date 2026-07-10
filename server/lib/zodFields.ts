import { z } from "zod";

// Replicate the old api/_shared/request helpers as zod schemas: trim, then HARD
// TRUNCATE to a cap (not reject), matching trimOptional/trimStringArray.

// Required string: missing/empty (after trim) fails with `message`; otherwise
// trimmed and truncated to `max`.
export const reqTrimmed = (max: number, message: string) =>
  z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim().slice(0, max))
    .refine((s) => s.length > 0, { message });

// Optional string: undefined when missing/empty, else trimmed + truncated.
export const optTrimmed = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => {
      const t = (s ?? "").trim().slice(0, max);
      return t.length ? t : undefined;
    });

// Optional string array: trim each, drop empties, cap item count + item length.
export const trimmedArray = (maxItems: number, maxLen: number) =>
  z
    .array(z.string())
    .optional()
    .transform((a) =>
      (a ?? [])
        .map((s) => s.trim().slice(0, maxLen))
        .filter(Boolean)
        .slice(0, maxItems),
    );
