import { Hono } from "hono";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { kanjiMnemonicRequestSchema } from "../../lib/api-contract";
import { isKanjiMnemonicStory } from "../../lib/kanji-mnemonic-ai";
import { authMiddleware } from "../middleware/auth";
import { maxBodyBytes } from "../middleware/bodySize";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import type { AppVariables } from "../types";

const MODEL = process.env.OPENAI_MNEMONIC_MODEL || "gpt-5.4-mini";
// Coarse pre-parse DoS guard (BYTES); the zod field caps are the real content
// limit. Sized well above the summed char caps (Japanese is ~3 bytes/char) —
// which the learner's own words and story exemplars doubled.
const MAX_BODY_BYTES = 16 * 1024;

const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["story"],
  properties: { story: { type: "string" } },
} as const;

export const kanjiMnemonicRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/kanji/mnemonic",
  maxBodyBytes(MAX_BODY_BYTES),
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
        "Write a concrete mnemonic story for a Heisig-style kanji learner. Prefer the shortest, cleverest phrasing that sticks — ideally one punchy sentence, never more than two; concise and vivid beats elaborate. Weave the given primitive keywords together as the imagery and land on the kanji's keyword as the punchline. " +
        // The learner's own words come from their past stories; using them is
        // what makes a generated story feel like theirs rather than generic.
        "`myWords` are the words this learner already uses for these primitives — prefer them over the primitive keywords when they fit. `examples` are their own stories; match their voice and length, not their content. " +
        // The markup the app renders: without it a generated story shows no
        // primitive chips and teaches the association index nothing.
        "Mark every primitive reference up as [label], or [label](target) when a target is given for it, and write the kanji's own keyword as {self}. Escape a literal [ ] { } with a backslash. Use the primitive keywords verbatim where natural. Return only the structured JSON requested by the schema.",
      input: {
        kanji: input.kanji,
        keyword: input.keyword,
        primitives: input.primitives,
        myWords: input.myWords,
        examples: input.examples,
      },
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
