import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { wordsContextRequestSchema } from "../../lib/api-contract";
import { filterPlayableSentences } from "../../lib/context-sentences";
import { authMiddleware } from "../middleware/auth";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import type { AppVariables } from "../types";

const MODEL =
  process.env.OPENAI_CONTEXT_SENTENCES_MODEL ||
  process.env.OPENAI_WORD_EXAMPLES_MODEL ||
  process.env.OPENAI_EXPLAIN_MODEL ||
  "gpt-5.4-mini";
// Batched request: 5 words of headword + reading + glosses + parts of speech.
const MAX_BODY_BYTES = 32 * 1024;
// Several words x several sentences x four fields, plus low-effort reasoning
// tokens, which also count against this budget.
const MAX_OUTPUT_TOKENS = 4000;
// Under the 60s function ceiling with room for the Clerk quota round-trips and a
// cold start on either side of the model call.
const TIMEOUT_MS = 35_000;

// Counts are stated in the instructions rather than the schema: minItems/maxItems
// are not supported under strict structured outputs.
const CONTEXT_SENTENCES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "sentences"],
        properties: {
          word: { type: "string" },
          sentences: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sentence", "targetSurface", "targetReading", "english"],
              properties: {
                sentence: { type: "string" },
                targetSurface: { type: "string" },
                targetReading: { type: "string" },
                english: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = [
  "Write natural Japanese example sentences that teach a word in context.",
  "For every word you are given, return that word in `word` exactly as supplied, plus the requested number of sentences.",
  "Rules for each sentence:",
  "- The target word MUST appear written with its kanji, never spelled out in kana alone.",
  "- The target word must appear EXACTLY ONCE in the sentence.",
  "- `targetSurface` is the target word exactly as it appears in the sentence, including any conjugation or okurigana (e.g. 食べました, not 食べる).",
  "- `targetReading` is the kana reading of `targetSurface` alone, matching that conjugation. Kana only — no kanji, no romaji, no punctuation.",
  "- `english` is a short natural translation of the whole sentence.",
  "- Keep sentences short (roughly 8 to 20 characters), everyday register, and useful to a learner.",
  "- Vary the grammar and situation across the sentences for a given word.",
  "Use the supplied reading, glosses, and part of speech to target the intended sense, and the JLPT level (5 = easiest, 1 = hardest) to pitch the surrounding vocabulary.",
  "Return only the structured JSON requested by the schema.",
].join("\n");

export const wordsContextRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/words/context-sentences",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  }),
  authMiddleware,
  entitlement("word_context_sentences"),
  jsonBody(wordsContextRequestSchema),
  rateLimit("word_context_sentences"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");

    const result = await createStructuredJson({
      logPrefix: "word-context-sentences",
      userId,
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: {
        sentencesPerWord: input.sentencesPerWord,
        words: input.words.map((word) => ({
          word: word.word,
          reading: word.reading ?? null,
          glosses: word.glosses ?? [],
          partOfSpeech: word.partOfSpeech ?? [],
          jlptLevel: word.jlptLevel ?? null,
        })),
      },
      schemaName: "word_context_sentences",
      schema: CONTEXT_SENTENCES_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: TIMEOUT_MS,
    });

    // Sentences the game can't render or grade are dropped, not returned. A word
    // that loses all of its sentences simply doesn't come back.
    const playable = filterPlayableSentences(
      result,
      input.words.map((word) => word.word),
      input.sentencesPerWord,
    );
    if (playable.items.length === 0) {
      console.error("[word-context-sentences] No playable sentences in response");
      throw new ApiError(502, "Example sentence response was malformed.");
    }
    return c.json({ result: playable });
  },
);
