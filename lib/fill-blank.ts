import { AiQuotaError, AiUnusableResponseError } from "./ai-errors";
import { createApiClient } from "./api-client";
import { getApiErrorMessage } from "./api-error";
import { KANA_ONLY, occurrences, surfaceBelongsToHeadword } from "./japanese-surface";

/** One tappable choice. `word` is the list headword it was drawn from. */
export interface FillBlankOption {
  word: string;
  /** The form shown in the choice, conjugated to fit the blank. */
  surface: string;
  /** Kana reading of `surface`. */
  reading: string;
}

export interface FillBlankQuestion {
  /**
   * The full sentence with the answer still in it. The blank is cut client-side
   * by searching for `answerSurface`, which is validated to occur exactly once —
   * far more robust than asking the model to place a placeholder token.
   */
  sentence: string;
  answerSurface: string;
  answerReading: string;
  english: string;
  /** One line on why the answer fits and the near misses don't. May be empty. */
  hint: string;
  /** Exactly three, all drawn from the candidate pool that was sent. */
  distractors: FillBlankOption[];
}

export interface FillBlankItem {
  /** The requested headword this question was generated for. */
  word: string;
  question: FillBlankQuestion;
}

export interface FillBlankQuestions {
  items: FillBlankItem[];
}

export const DISTRACTOR_COUNT = 3;

const MAX_SENTENCE_LENGTH = 60;
const MAX_SURFACE_LENGTH = 24;
const MAX_ENGLISH_LENGTH = 200;
const MAX_HINT_LENGTH = 160;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/** The model echoes words back, so compare on a normalized form. */
const normalize = (text: string) => text.normalize("NFC").trim();

/** Normalized candidate word → the word exactly as the client supplied it. */
export type CandidatePool = Map<string, string>;

export function toCandidatePool(words: { word: string }[]): CandidatePool {
  return new Map(words.map((candidate) => [normalize(candidate.word), candidate.word]));
}

/**
 * A distractor is rendered as a tappable button, so every field of it is checked.
 * `word` must be one the client offered — that is what makes "all four options
 * come from your own list" a guarantee rather than a hope — and `surface` must
 * actually belong to that word, since it is otherwise free model text.
 */
export function toPlayableOption(
  value: unknown,
  candidates: CandidatePool,
): FillBlankOption | null {
  if (!value || typeof value !== "object") return null;
  const { word, surface, reading } = value as Partial<FillBlankOption>;

  if (!isNonEmptyString(word, MAX_SURFACE_LENGTH)) return null;
  if (!isNonEmptyString(surface, MAX_SURFACE_LENGTH)) return null;
  if (!isNonEmptyString(reading, MAX_SURFACE_LENGTH)) return null;

  // Resolved back to the client's own string, so the option carries a word the
  // caller can match against its list rather than the model's rendering of it.
  const supplied = candidates.get(normalize(word));
  if (!supplied) return null;
  if (!KANA_ONLY.test(reading)) return null;
  if (!surfaceBelongsToHeadword(surface, supplied)) return null;

  return { word: supplied, surface, reading };
}

/**
 * Normalize one question, or reject it. The screen blanks the sentence, colors
 * the chosen option, and grades by identity, so a question that breaks any of
 * these invariants can't be played and is dropped rather than shown.
 */
export function toPlayableQuestion(
  value: unknown,
  headword: string,
  candidates: CandidatePool,
): FillBlankQuestion | null {
  if (!value || typeof value !== "object") return null;
  const { sentence, answerSurface, answerReading, english, hint, distractors } =
    value as Partial<FillBlankQuestion>;

  if (!isNonEmptyString(sentence, MAX_SENTENCE_LENGTH)) return null;
  if (!isNonEmptyString(answerSurface, MAX_SURFACE_LENGTH)) return null;
  if (!isNonEmptyString(answerReading, MAX_SURFACE_LENGTH)) return null;
  if (!isNonEmptyString(english, MAX_ENGLISH_LENGTH)) return null;
  if (typeof hint !== "string") return null;

  // Exactly once, so the blank is unambiguous.
  if (occurrences(sentence, answerSurface) !== 1) return null;
  if (!KANA_ONLY.test(answerReading)) return null;
  // The model wrote a sentence about some other word.
  if (!surfaceBelongsToHeadword(answerSurface, headword)) return null;
  if (!Array.isArray(distractors)) return null;

  const seenWords = new Set<string>([headword]);
  const seenSurfaces = new Set<string>([answerSurface]);
  // Readings too: 見る and 観る are separate list words that both conjugate to
  // みます, so matching on word and surface alone would show two right answers.
  const seenReadings = new Set<string>([answerReading]);
  const playable: FillBlankOption[] = [];

  for (const candidate of distractors) {
    const option = toPlayableOption(candidate, candidates);
    if (!option) continue;
    // A second right answer, a duplicated button, or a word already sitting in
    // the sentence next to the blank it is supposed to fill.
    if (seenWords.has(option.word) || seenSurfaces.has(option.surface)) continue;
    if (seenReadings.has(option.reading)) continue;
    if (sentence.includes(option.surface)) continue;

    seenWords.add(option.word);
    seenSurfaces.add(option.surface);
    seenReadings.add(option.reading);
    playable.push(option);
    if (playable.length === DISTRACTOR_COUNT) break;
  }

  if (playable.length < DISTRACTOR_COUNT) return null;

  return {
    sentence,
    answerSurface,
    answerReading,
    english,
    hint: hint.slice(0, MAX_HINT_LENGTH),
    distractors: playable,
  };
}

export interface FillBlankCandidate {
  word: string;
  reading?: string | null;
  glosses?: string[];
}

export interface FillBlankRequestWord {
  word: string;
  reading?: string | null;
  glosses?: string[];
  partOfSpeech?: string[];
  jlptLevel?: number | null;
  /** The pool the model must draw its three distractors from. */
  candidates: FillBlankCandidate[];
}

/**
 * Keep only the questions the game can play, for the words that were actually
 * asked about. `word` is echoed by the model, so an item naming a word that
 * wasn't requested — or a second item for a word already seen — is dropped.
 */
export function filterPlayableQuestions(
  value: unknown,
  requests: FillBlankRequestWord[],
): FillBlankQuestions {
  const items = (value as Partial<FillBlankQuestions> | null)?.items;
  if (!Array.isArray(items)) return { items: [] };

  const requested = new Map(
    requests.map((request) => [
      normalize(request.word),
      { word: request.word, candidates: toCandidatePool(request.candidates) },
    ]),
  );
  const seen = new Set<string>();
  const cleaned: FillBlankItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { word: echoed, question } = item as Partial<FillBlankItem>;
    if (typeof echoed !== "string") continue;

    const request = requested.get(normalize(echoed));
    if (!request || seen.has(request.word)) continue;

    const playable = toPlayableQuestion(question, request.word, request.candidates);
    if (!playable) continue;

    seen.add(request.word);
    cleaned.push({ word: request.word, question: playable });
  }
  return { items: cleaned };
}

// Mirrors the caps in wordsFillBlankRequestSchema so the words the client filters
// against are the same strings the server echoed back.
const MAX_WORDS_PER_REQUEST = 4;
const MAX_WORD_LENGTH = 80;
const MAX_CANDIDATES_PER_WORD = 10;
// Past the server's own 35s model timeout and its 60s function ceiling, so a
// request that never answers surfaces as an error instead of an endless spinner.
const REQUEST_TIMEOUT_MS = 70_000;

export async function requestFillBlankQuestions({
  apiBaseUrl,
  getToken,
  words,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
  words: FillBlankRequestWord[];
}): Promise<FillBlankQuestions> {
  const trimmed = words
    .map((entry) => ({
      ...entry,
      word: entry.word.trim().slice(0, MAX_WORD_LENGTH),
      candidates: entry.candidates.slice(0, MAX_CANDIDATES_PER_WORD),
    }))
    .filter((entry) => entry.word.length > 0 && entry.candidates.length >= DISTRACTOR_COUNT);

  if (trimmed.length === 0) {
    throw new Error("Choose a word to build a question from.");
  }
  if (trimmed.length > MAX_WORDS_PER_REQUEST) {
    throw new Error(`Request at most ${MAX_WORDS_PER_REQUEST} words at a time.`);
  }
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const token = await getToken();
  if (!token) {
    throw new Error("Sign in to generate questions.");
  }

  const client = createApiClient(apiBaseUrl, token);

  // AbortController + timer rather than AbortSignal.timeout: React Native
  // polyfills the controller but not that static factory.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const response = await client.api.words["fill-blank"]
    .$post(
      {
        json: {
          words: trimmed.map((entry) => ({
            word: entry.word,
            reading: entry.reading ?? undefined,
            glosses: entry.glosses ?? undefined,
            partOfSpeech: entry.partOfSpeech ?? undefined,
            // Clamped rather than forwarded raw: the server range-validates this,
            // so an out-of-range level would 400 the whole batch.
            jlptLevel: Number.isFinite(entry.jlptLevel)
              ? Math.min(5, Math.max(1, Math.round(entry.jlptLevel as number)))
              : undefined,
            candidates: entry.candidates.map((candidate) => ({
              word: candidate.word,
              reading: candidate.reading ?? undefined,
              glosses: candidate.glosses ?? undefined,
            })),
          })),
        },
      },
      { init: { signal: controller.signal } },
    )
    .finally(() => clearTimeout(timer));
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = getApiErrorMessage(body, "Could not generate questions.");
    const code = (body as { code?: string } | null)?.code;
    // Both mean "stop generating for today" — only the message differs.
    if (code === "quota_exceeded" || code === "global_quota_exceeded") {
      throw new AiQuotaError(message);
    }
    if (code === "unusable_response") throw new AiUnusableResponseError(message);
    throw new Error(message);
  }

  // Re-filtered here too: the screen renders these straight into buttons, so an
  // unplayable question must never reach it, whatever the server returned.
  const result = filterPlayableQuestions((body as { result?: unknown } | null)?.result, trimmed);
  if (result.items.length === 0) {
    throw new AiUnusableResponseError("Question response was malformed.");
  }
  return result;
}
