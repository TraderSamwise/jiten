import type { VercelRequest, VercelResponse } from "@vercel/node";

import { ApiError, verifyApiUser } from "../_shared/auth";
import { setCors } from "../_shared/cors";
import { assertFeatureAccess } from "../_shared/entitlements";
import { sendApiError } from "../_shared/errors";
import { createStructuredJson } from "../_shared/openai";
import { consumeDailyUserQuota, setRateLimitHeaders } from "../_shared/rate-limit";
import { parseJsonObjectBody, trimOptional, trimStringArray } from "../_shared/request";
import type { WordExampleSentencesRequest, WordExampleSentences } from "../../lib/word-examples";
import { isWordExampleSentences } from "../../lib/word-examples";

const MODEL =
  process.env.OPENAI_WORD_EXAMPLES_MODEL || process.env.OPENAI_EXPLAIN_MODEL || "gpt-5.4-mini";
const MAX_BODY_CHARS = 4096;
const MAX_WORD_CHARS = 80;

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

function parseRequestBody(req: VercelRequest): WordExampleSentencesRequest {
  const payload = parseJsonObjectBody(req, MAX_BODY_CHARS);
  const word = trimOptional(payload.word, MAX_WORD_CHARS);
  if (!word) {
    throw new ApiError(400, "word is required");
  }

  return {
    word,
    reading: trimOptional(payload.reading, MAX_WORD_CHARS),
    glosses: trimStringArray(payload.glosses, 6, 120),
    partOfSpeech: trimStringArray(payload.partOfSpeech, 8, 60),
  };
}

async function createExampleSentences(
  input: WordExampleSentencesRequest,
  userId: string,
): Promise<WordExampleSentences> {
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
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = await verifyApiUser(req);
    await assertFeatureAccess(userId, "word_example_sentences");
    const input = parseRequestBody(req);
    const quota = await consumeDailyUserQuota(userId, "word_example_sentences");
    setRateLimitHeaders(res, quota);
    const result = await createExampleSentences(input, userId);
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof ApiError) {
      return sendApiError(res, err);
    }
    console.error("[word-example-sentences] Error:", err);
    return res.status(500).json({ error: "Could not generate example sentences." });
  }
}
