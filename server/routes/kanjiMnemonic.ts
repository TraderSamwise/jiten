import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { kanjiMnemonicRequestSchema } from "../../lib/api-contract";
import { isKanjiMnemonicStory } from "../../lib/kanji-mnemonic-ai";
import { authMiddleware } from "../middleware/auth";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import type { AppVariables } from "../types";

const MODEL = process.env.OPENAI_MNEMONIC_MODEL || "gpt-5.4-mini";
// Coarse pre-parse DoS guard (BYTES); the zod field caps are the real content
// limit. Sized well above the summed char caps (Japanese is ~3 bytes/char).
const MAX_BODY_BYTES = 8 * 1024;

const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["story"],
  properties: { story: { type: "string" } },
} as const;

export const kanjiMnemonicRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/kanji/mnemonic",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  }),
  authMiddleware,
  entitlement("kanji_mnemonic"),
  jsonBody(kanjiMnemonicRequestSchema),
  rateLimit("kanji_mnemonic"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");
    const result = await createStructuredJson({
      logPrefix: "kanji-mnemonic",
      userId,
      model: MODEL,
      instructions:
        "Write a vivid, concrete mnemonic story (1-2 sentences) for a Heisig-style kanji learner. Weave the given primitive keywords together as the imagery and land on the kanji's keyword as the punchline. Use the primitive keywords verbatim where natural. Return only the structured JSON requested by the schema.",
      input: { kanji: input.kanji, keyword: input.keyword, primitives: input.primitives },
      schemaName: "kanji_mnemonic",
      schema: STORY_SCHEMA,
      maxOutputTokens: 300,
    });

    if (!isKanjiMnemonicStory(result)) {
      console.error("[kanji-mnemonic] Malformed story response");
      throw new ApiError(502, "Story response was malformed.");
    }
    return c.json({ story: result.story });
  },
);
