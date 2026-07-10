import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { isReaderSentenceExplanation } from "../../lib/reader-explain";
import { authMiddleware } from "../middleware/auth";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import { optTrimmed, reqTrimmed } from "../lib/zodFields";
import type { AppVariables } from "../types";

const MODEL = process.env.OPENAI_EXPLAIN_MODEL || "gpt-5.4-mini";
const MAX_BODY_CHARS = 4096;

const requestSchema = z.object({
  selectedText: reqTrimmed(500, "selectedText is required"),
  bookTitle: optTrimmed(160),
  surroundingText: optTrimmed(1200),
});

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

export const readerExplainRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/reader/explain-sentence",
  bodyLimit({
    maxSize: MAX_BODY_CHARS,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  }),
  authMiddleware,
  entitlement("reader_sentence_explain"),
  jsonBody(requestSchema),
  rateLimit("reader_sentence_explain"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");
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
    return c.json({ explanation });
  },
);
