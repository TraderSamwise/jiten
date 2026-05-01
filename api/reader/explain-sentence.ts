import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiError, verifyApiUser } from "../_shared/auth";
import { setCors } from "../_shared/cors";
import { assertFeatureAccess } from "../_shared/entitlements";
import { sendApiError } from "../_shared/errors";
import { createStructuredJson } from "../_shared/openai";
import { consumeDailyUserQuota, setRateLimitHeaders } from "../_shared/rate-limit";
import { parseJsonObjectBody, trimOptional } from "../_shared/request";
import type { ReaderExplainRequest, ReaderSentenceExplanation } from "../../lib/reader-explain";
import { isReaderSentenceExplanation } from "../../lib/reader-explain";

const MODEL = process.env.OPENAI_EXPLAIN_MODEL || "gpt-5.4-mini";
const MAX_BODY_CHARS = 4096;
const MAX_SELECTION_CHARS = 500;
const MAX_CONTEXT_CHARS = 1200;

const EXPLANATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "translation", "grammar", "vocabulary", "notes"],
  properties: {
    summary: { type: "string" },
    translation: { type: "string" },
    grammar: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "explanation"],
        properties: {
          label: { type: "string" },
          explanation: { type: "string" },
        },
      },
    },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "reading", "meaning", "note"],
        properties: {
          term: { type: "string" },
          reading: { type: "string" },
          meaning: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    notes: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

function parseRequestBody(req: VercelRequest): ReaderExplainRequest {
  const payload = parseJsonObjectBody(req, MAX_BODY_CHARS);
  const selectedText = trimOptional(payload.selectedText, MAX_SELECTION_CHARS);
  if (!selectedText) {
    throw new ApiError(400, "selectedText is required");
  }
  return {
    selectedText,
    bookTitle: trimOptional(payload.bookTitle, 160),
    surroundingText: trimOptional(payload.surroundingText, MAX_CONTEXT_CHARS),
  };
}

async function createExplanation(
  input: ReaderExplainRequest,
  userId: string,
): Promise<ReaderSentenceExplanation> {
  const explanation = await createStructuredJson({
    logPrefix: "explain-sentence",
    userId,
    model: MODEL,
    instructions:
      "Explain selected Japanese reading text for an English-speaking learner. Be concise, practical, and accurate. Return only the structured JSON requested by the schema. Use at most four grammar items, five vocabulary items, and three notes. If context is insufficient, explain the most likely reading and mention uncertainty in notes.",
    input: {
      selectedText: input.selectedText,
      bookTitle: input.bookTitle ?? null,
      surroundingText: input.surroundingText ?? null,
    },
    schemaName: "reader_sentence_explanation",
    schema: EXPLANATION_SCHEMA,
    maxOutputTokens: 900,
  });

  if (!isReaderSentenceExplanation(explanation)) {
    console.error("[explain-sentence] Malformed explanation response");
    throw new ApiError(502, "Explanation response was malformed.");
  }
  return explanation;
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
    await assertFeatureAccess(userId, "reader_sentence_explain");
    const input = parseRequestBody(req);
    const quota = await consumeDailyUserQuota(userId, "reader_sentence_explain");
    setRateLimitHeaders(res, quota);
    const explanation = await createExplanation(input, userId);
    return res.status(200).json({ explanation });
  } catch (err) {
    if (err instanceof ApiError) {
      return sendApiError(res, err);
    }
    console.error("[explain-sentence] Error:", err);
    return res.status(500).json({ error: "Could not explain selection." });
  }
}
