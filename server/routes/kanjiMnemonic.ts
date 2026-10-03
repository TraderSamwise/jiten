import { Hono } from "hono";

import { ApiError } from "../../api/_shared/auth";
import { createStructuredJson } from "../../api/_shared/openai";
import { kanjiMnemonicRequestSchema } from "../../lib/api-contract";
import { isKanjiMnemonicStory } from "../../lib/kanji-mnemonic-ai";
import { firstSentences } from "../../lib/wikitext";
import { crowdStoryFor, glyphOriginFor } from "../lib/kanji-lore";
import { authMiddleware } from "../middleware/auth";
import { maxBodyBytes } from "../middleware/bodySize";
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
  maxBodyBytes(MAX_BODY_BYTES),
  authMiddleware,
  entitlement("kanji_mnemonic"),
  jsonBody(kanjiMnemonicRequestSchema),
  rateLimit("kanji_mnemonic"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");

    // Grounding, fetched in parallel and allowed to come back empty: a story
    // written without them is worse, not wrong.
    const [glyphOrigin, crowdStory] = await Promise.all([
      glyphOriginFor(input.kanji),
      crowdStoryFor(input.kanji),
    ]);

    const result = await createStructuredJson({
      logPrefix: "kanji-mnemonic",
      userId,
      model: MODEL,
      instructions:
        "Write a concrete mnemonic story for a Heisig-style kanji learner. Prefer the shortest, cleverest phrasing that sticks — ideally one punchy sentence, never more than two; concise and vivid beats elaborate. Weave the given primitive keywords together as the imagery and land on the kanji's keyword as the punchline. " +
        // The markup the app renders. Only the bare [label] form: the payload
        // carries keywords, never targets, and inviting `(target)` got the model
        // to invent one — which isValidTarget accepts and the reader then
        // resolves to an unrelated primitive.
        "Mark every primitive reference up as [label], using the primitive keyword as the label. Do not write a (target) after it. Refer to the kanji's own keyword in words rather than with any marker. Escape a literal [ ] { } with a backslash. Use the primitive keywords verbatim where natural. " +
        // What the two grounding fields are for. They are raw material, not
        // content to pass through: one is another learner's writing and the
        // other is an encyclopaedia's, and the learner asked us for a story.
        "glyphOrigin, when present, is what the character actually depicts, from a dictionary of etymology; prefer it as the imagery when it is concrete, because a true picture outlasts an invented one. crowdStory, when present, is the hook another learner found memorable; take the idea, never the wording. Write your own sentence in both cases: never quote, copy or lightly reword either field, and do not mention that they exist. " +
        "Return only the structured JSON requested by the schema.",
      input: {
        kanji: input.kanji,
        keyword: input.keyword,
        primitives: input.primitives,
        // Capped: a long etymology section would crowd out the instructions,
        // and the first sentences are the ones that describe the glyph.
        ...(glyphOrigin ? { glyphOrigin: firstSentences(glyphOrigin, 400) } : {}),
        ...(crowdStory ? { crowdStory: firstSentences(crowdStory, 400) } : {}),
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
