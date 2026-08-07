import { Hono } from "hono";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { wordsExampleRequestSchema } from "../../lib/api-contract";
import { isWordExampleSentences } from "../../lib/word-examples";
import { authMiddleware } from "../middleware/auth";
import { maxBodyBytes } from "../middleware/bodySize";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import type { AppVariables } from "../types";

const MODEL =
  process.env.OPENAI_WORD_EXAMPLES_MODEL || process.env.OPENAI_EXPLAIN_MODEL || "gpt-5.4-mini";
// Coarse pre-parse DoS guard (BYTES) — see readerExplain; sized above the summed
// zod char caps to fit max-length UTF-8 (Japanese ~3 bytes/char) fields.
const MAX_BODY_BYTES = 16 * 1024;

const WORD_EXAMPLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["examples"],
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["japanese", "reading", "english", "note"],
        properties: {
          japanese: { type: "string" },
          reading: { type: "string" },
          english: { type: "string" },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

export const wordsExampleRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/words/example-sentences",
  maxBodyBytes(MAX_BODY_BYTES),
  authMiddleware,
  entitlement("word_example_sentences"),
  jsonBody(wordsExampleRequestSchema),
  rateLimit("word_example_sentences"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");
    const result = await createStructuredJson({
      logPrefix: "word-example-sentences",
      userId,
      model: MODEL,
      instructions:
        "Generate exactly three natural Japanese example sentences for a dictionary headword. Use the supplied reading, glosses, and part of speech to target the intended sense. Keep examples short, useful for learners, and varied in grammar. Return only the structured JSON requested by the schema.",
      input: {
        word: input.word,
        reading: input.reading ?? null,
        glosses: input.glosses ?? [],
        partOfSpeech: input.partOfSpeech ?? [],
      },
      schemaName: "word_example_sentences",
      schema: WORD_EXAMPLES_SCHEMA,
      maxOutputTokens: 700,
    });

    if (!isWordExampleSentences(result)) {
      console.error("[word-example-sentences] Malformed response");
      throw new ApiError(502, "Example sentence response was malformed.");
    }
    return c.json({ result });
  },
);
