import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiError, verifyApiUser } from "../_shared/auth";
import { setCors } from "../_shared/cors";
import { assertFeatureAccess } from "../_shared/entitlements";
import { consumeDailyUserQuota, setRateLimitHeaders } from "../_shared/rate-limit";
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

interface OpenAIResponseContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OpenAIResponseOutput {
  type?: string;
  content?: OpenAIResponseContent[];
}

interface OpenAIResponseBody {
  output_text?: string;
  output?: OpenAIResponseOutput[];
}

function trimOptional(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function assertRequestEnvelope(req: VercelRequest): void {
  const contentType = req.headers["content-type"];
  if (contentType && !String(contentType).toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json");
  }

  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_CHARS) {
    throw new ApiError(413, "Request body is too large");
  }
  if (typeof req.body === "string" && req.body.length > MAX_BODY_CHARS) {
    throw new ApiError(413, "Request body is too large");
  }
}

function parseRequestBody(req: VercelRequest): ReaderExplainRequest {
  assertRequestEnvelope(req);

  let body: unknown;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof req.body !== "string" && JSON.stringify(payload).length > MAX_BODY_CHARS) {
    throw new ApiError(413, "Request body is too large");
  }
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

function extractOutputText(response: OpenAIResponseBody): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  for (const output of response.output ?? []) {
    if (output?.type !== "message") continue;
    for (const content of output.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
      if (content?.type === "refusal" && typeof content.refusal === "string") {
        throw new ApiError(400, content.refusal);
      }
    }
  }
  return null;
}

async function createExplanation(
  input: ReaderExplainRequest,
  userId: string,
): Promise<ReaderSentenceExplanation> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[explain-sentence] Missing OPENAI_API_KEY");
    throw new ApiError(500, "Server misconfigured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      instructions:
        "Explain selected Japanese reading text for an English-speaking learner. Be concise, practical, and accurate. Return only the structured JSON requested by the schema. Use at most four grammar items, five vocabulary items, and three notes. If context is insufficient, explain the most likely reading and mention uncertainty in notes.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                selectedText: input.selectedText,
                bookTitle: input.bookTitle ?? null,
                surroundingText: input.surroundingText ?? null,
              }),
            },
          ],
        },
      ],
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "reader_sentence_explanation",
          strict: true,
          schema: EXPLANATION_SCHEMA,
        },
      },
      max_output_tokens: 900,
      user: userId,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[explain-sentence] OpenAI error", response.status, body.slice(0, 500));
    throw new ApiError(502, "Could not explain selection.");
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  if (!outputText) {
    console.error("[explain-sentence] Missing output text");
    throw new ApiError(502, "Explanation response was empty.");
  }

  let explanation: unknown;
  try {
    explanation = JSON.parse(outputText);
  } catch {
    console.error("[explain-sentence] Non-JSON explanation response");
    throw new ApiError(502, "Explanation response was malformed.");
  }
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
      return res.status(err.status).json({ error: err.message });
    }
    console.error("[explain-sentence] Error:", err);
    return res.status(500).json({ error: "Could not explain selection." });
  }
}
