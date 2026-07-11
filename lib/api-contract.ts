import { z } from "zod";

// Shared request contract for the API. Lives in lib/ (not a packages/* workspace)
// so both the RN client and the server bundle it via the same proven relative
// imports — server/routes already import lib/ modules into the Vercel function.
// The zod schemas trim, then HARD TRUNCATE to a cap (not reject), matching the
// old api/_shared/request helpers (trimOptional/trimStringArray).

// Required string: empty (after trim) fails with `message`; otherwise trimmed
// and truncated to `max`. Not `.optional()` — the field is required, so the RPC
// client types (hc<AppType>) also require it rather than only failing at runtime.
export const reqTrimmed = (max: number, message: string) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
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

export const readerExplainRequestSchema = z.object({
  selectedText: reqTrimmed(500, "selectedText is required"),
  bookTitle: optTrimmed(160),
  surroundingText: optTrimmed(1200),
});

export const wordsExampleRequestSchema = z.object({
  word: reqTrimmed(80, "word is required"),
  reading: optTrimmed(80),
  glosses: trimmedArray(6, 120),
  partOfSpeech: trimmedArray(8, 60),
});

export const kanjiMnemonicRequestSchema = z.object({
  kanji: reqTrimmed(8, "kanji is required"),
  keyword: reqTrimmed(120, "keyword is required"),
  primitives: trimmedArray(12, 120),
});
