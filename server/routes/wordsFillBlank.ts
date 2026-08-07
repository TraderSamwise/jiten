import { Hono } from "hono";

import { createStructuredJson } from "../../api/_shared/openai";
import { wordsFillBlankRequestSchema } from "../../lib/api-contract";
import { filterPlayableQuestions } from "../../lib/fill-blank";
import { authMiddleware } from "../middleware/auth";
import { maxBodyBytes } from "../middleware/bodySize";
import { entitlement } from "../middleware/entitlement";
import { rateLimit } from "../middleware/rateLimit";
import { jsonBody } from "../middleware/validate";
import type { AppVariables } from "../types";

const MODEL =
  process.env.OPENAI_FILL_BLANK_MODEL ||
  process.env.OPENAI_CONTEXT_SENTENCES_MODEL ||
  process.env.OPENAI_WORD_EXAMPLES_MODEL ||
  process.env.OPENAI_EXPLAIN_MODEL ||
  "gpt-5.4-mini";
// Four words, each carrying a pool of up to ten candidates. Kana costs three
// bytes where the zod caps count UTF-16 characters, so this leaves real headroom.
const MAX_BODY_BYTES = 64 * 1024;
// Four questions x fourteen fields, plus low-effort reasoning tokens — which also
// count against this budget, and picking good distractors is the reasoning-heavy
// part. A truncated response is a 502 with no code, which the client retries and
// pays for twice, so this is deliberately not tight.
const MAX_OUTPUT_TOKENS = 6000;
// Under the 60s function ceiling with room for the quota round-trips and a cold
// start on either side of the model call.
const TIMEOUT_MS = 35_000;

// Counts are stated in the instructions rather than the schema: minItems/maxItems
// are not supported under strict structured outputs.
const FILL_BLANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "question"],
        properties: {
          word: { type: "string" },
          question: {
            type: "object",
            additionalProperties: false,
            required: [
              "sentence",
              "answerSurface",
              "answerReading",
              "english",
              "hint",
              "distractors",
            ],
            properties: {
              sentence: { type: "string" },
              answerSurface: { type: "string" },
              answerReading: { type: "string" },
              english: { type: "string" },
              hint: { type: "string" },
              distractors: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["word", "surface", "reading"],
                  properties: {
                    word: { type: "string" },
                    surface: { type: "string" },
                    reading: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = [
  "Write JLPT-style multiple-choice vocabulary questions: a natural sentence, and four words of which exactly one fits.",
  "For every word you are given, return that word in `word` exactly as supplied, plus one question.",
  "Rules for each question:",
  "- `sentence` is a natural Japanese sentence containing the target word EXACTLY ONCE. Write the sentence in full — do not blank anything out.",
  "- `answerSurface` is the target word exactly as it appears in the sentence, including any conjugation or okurigana (e.g. 飲みました, not 飲む).",
  "- `answerReading` is the kana reading of `answerSurface` alone. Kana only — no kanji, no romaji, no punctuation.",
  "- Choose EXACTLY THREE distractors, and take every one of them from that word's `candidates` list. Never invent a word or use one from another word's list.",
  "- Choose the three a learner is most likely to confuse with the target — closest in meaning, same part of speech, same register. Do not choose randomly.",
  "- Each distractor's `word` is copied exactly from `candidates`. Its `surface` is that word conjugated into EXACTLY the same grammatical form as `answerSurface`, so all four choices are parallel and the question cannot be solved by grammar alone. Its `reading` is the kana reading of `surface`.",
  "- The sentence must make the target the only sensible choice: substituting any distractor should stay grammatical but be clearly wrong in meaning.",
  "- No distractor's `surface` may appear anywhere in the sentence.",
  "- `english` is a short natural translation of the whole sentence.",
  "- `hint` is one short English clause naming the nuance that separates the answer from the closest distractor.",
  "- Keep sentences roughly 10 to 30 characters and everyday register.",
  "Use the supplied reading, glosses, and part of speech to target the intended sense, and the JLPT level (5 = easiest, 1 = hardest) to pitch the surrounding vocabulary.",
  "Return only the structured JSON requested by the schema.",
].join("\n");

export const wordsFillBlankRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/words/fill-blank",
  maxBodyBytes(MAX_BODY_BYTES),
  authMiddleware,
  entitlement("word_fill_blank"),
  jsonBody(wordsFillBlankRequestSchema),
  rateLimit("word_fill_blank"),
  async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");

    const result = await createStructuredJson({
      logPrefix: "word-fill-blank",
      userId,
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: {
        words: input.words.map((word) => ({
          word: word.word,
          reading: word.reading ?? null,
          glosses: word.glosses ?? [],
          partOfSpeech: word.partOfSpeech ?? [],
          jlptLevel: word.jlptLevel ?? null,
          candidates: word.candidates.map((candidate) => ({
            word: candidate.word,
            reading: candidate.reading ?? null,
            glosses: candidate.glosses ?? [],
          })),
        })),
      },
      schemaName: "word_fill_blank",
      schema: FILL_BLANK_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: TIMEOUT_MS,
    });

    // Questions the game can't play are dropped, not returned — including any
    // whose distractors strayed outside the pool the client offered.
    const playable = filterPlayableQuestions(result, input.words);
    if (playable.items.length === 0) {
      console.error("[word-fill-blank] No playable questions in response");
      // Coded so the client can tell this apart from a transient failure: the
      // quota is already spent, so retrying would pay twice for the same answer.
      return c.json(
        { error: "No usable questions were generated.", code: "unusable_response" },
        502,
      );
    }
    return c.json({ result: playable });
  },
);
