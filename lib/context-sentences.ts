import { createApiClient } from "./api-client";
import { getApiErrorMessage } from "./api-error";

export interface ContextSentence {
  /** Full Japanese sentence containing the target word written in kanji. */
  sentence: string;
  /** The target word exactly as it appears in the sentence, conjugation included. */
  targetSurface: string;
  /** Kana reading of `targetSurface` alone — what the player types. */
  targetReading: string;
  english: string;
}

export interface ContextSentenceItem {
  /** The requested headword these sentences were generated for. */
  word: string;
  sentences: ContextSentence[];
}

export interface ContextSentences {
  items: ContextSentenceItem[];
}

const MAX_SENTENCE_LENGTH = 60;
const MAX_SURFACE_LENGTH = 24;
const MAX_ENGLISH_LENGTH = 200;

const KANA_ONLY = /^[ぁ-ゖァ-ヺーヽヾゝゞ]+$/;
const HAS_KANJI = /[一-鿿々]/;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * A conjugated surface keeps the headword's kanji: 食べる → 食べました, 新しい →
 * 新しかった. Requiring a shared kanji (and the same opening kanji, when the
 * headword starts with one) rejects a sentence that targets some other word
 * entirely — which passes every intra-sentence check on its own.
 */
export function matchesHeadword(targetSurface: string, headword: string): boolean {
  const headwordKanji = [...headword].filter((ch) => HAS_KANJI.test(ch));
  if (headwordKanji.length === 0) return true;

  if (!headwordKanji.some((ch) => targetSurface.includes(ch))) return false;

  const firstChar = [...headword][0];
  if (HAS_KANJI.test(firstChar)) {
    // お待ちください / ご飯 — an honorific prefix is part of the surface, not the headword.
    const stripped = targetSurface.replace(/^[おご御]/, "");
    if ([...stripped][0] !== firstChar) return false;
  }

  return true;
}

/**
 * The game colors the target red by slicing the sentence around `targetSurface`
 * and grades what the player types against `targetReading`. A sentence that
 * breaks any of these invariants can't be rendered or graded, so it is dropped
 * rather than shown.
 */
export function isPlayableContextSentence(value: unknown): value is ContextSentence {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContextSentence>;
  const { sentence, targetSurface, targetReading, english } = candidate;

  if (
    typeof sentence !== "string" ||
    typeof targetSurface !== "string" ||
    typeof targetReading !== "string" ||
    typeof english !== "string"
  ) {
    return false;
  }
  if (!sentence || !targetSurface || !targetReading || !english) return false;
  if (
    sentence.length > MAX_SENTENCE_LENGTH ||
    targetSurface.length > MAX_SURFACE_LENGTH ||
    targetReading.length > MAX_SURFACE_LENGTH ||
    english.length > MAX_ENGLISH_LENGTH
  ) {
    return false;
  }
  // Exactly once, so the red span is unambiguous.
  if (occurrences(sentence, targetSurface) !== 1) return false;
  // The whole point is reading kanji in context.
  if (!HAS_KANJI.test(targetSurface)) return false;
  if (!KANA_ONLY.test(targetReading)) return false;

  return true;
}

/**
 * Keep only the sentences the game can render and grade, for the words that were
 * actually asked about. `word` is echoed by the model, so an item naming a word
 * that wasn't requested — or a second item for a word already seen — is dropped.
 */
export function filterPlayableSentences(
  value: unknown,
  requestedWords: string[],
  maxSentencesPerWord = Number.MAX_SAFE_INTEGER,
): ContextSentences {
  const items = (value as Partial<ContextSentences> | null)?.items;
  if (!Array.isArray(items)) return { items: [] };

  // The model echoes `word` back; normalize so stray whitespace or a decomposed
  // form doesn't discard an otherwise good response.
  const normalize = (value: string) => value.normalize("NFC").trim();
  const requested = new Map(requestedWords.map((word) => [normalize(word), word]));
  const seen = new Set<string>();
  const cleaned: ContextSentenceItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { word: echoed, sentences } = item as Partial<ContextSentenceItem>;
    if (typeof echoed !== "string") continue;
    const word = requested.get(normalize(echoed));
    if (!word || seen.has(word)) continue;
    if (!Array.isArray(sentences)) continue;

    const playable = sentences
      .filter(
        (sentence): sentence is ContextSentence =>
          isPlayableContextSentence(sentence) && matchesHeadword(sentence.targetSurface, word),
      )
      .slice(0, maxSentencesPerWord);

    if (playable.length > 0) {
      seen.add(word);
      cleaned.push({ word, sentences: playable });
    }
  }
  return { items: cleaned };
}

// Mirrors the caps in wordsContextRequestSchema so the words the client filters
// against are the same strings the server echoed back.
const MAX_WORDS_PER_REQUEST = 5;
const MAX_WORD_LENGTH = 80;

export interface ContextSentenceRequestWord {
  word: string;
  reading?: string | null;
  glosses?: string[];
  partOfSpeech?: string[];
  jlptLevel?: number | null;
}

/** Thrown when the daily AI quota is spent, so a caller can stop prefetching. */
export class ContextSentenceQuotaError extends Error {
  readonly code = "quota_exceeded";
  readonly name = "ContextSentenceQuotaError";
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export async function requestContextSentences({
  apiBaseUrl,
  getToken,
  words,
  sentencesPerWord,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
  words: ContextSentenceRequestWord[];
  sentencesPerWord?: number;
}): Promise<ContextSentences> {
  const trimmed = words
    .map((entry) => ({ ...entry, word: entry.word.trim().slice(0, MAX_WORD_LENGTH) }))
    .filter((entry) => entry.word.length > 0);

  if (trimmed.length === 0) {
    throw new Error("Choose a word to generate sentences.");
  }
  if (trimmed.length > MAX_WORDS_PER_REQUEST) {
    throw new Error(`Request at most ${MAX_WORDS_PER_REQUEST} words at a time.`);
  }
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const token = await getToken();
  if (!token) {
    throw new Error("Sign in to generate sentences.");
  }

  // Clamped rather than forwarded raw: these are range-validated server-side, so
  // an out-of-range value would 400 the whole batch.
  const perWord = sentencesPerWord == null ? undefined : clamp(sentencesPerWord, 1, 3);

  const client = createApiClient(apiBaseUrl, token);
  const response = await client.api.words["context-sentences"].$post({
    json: {
      words: trimmed.map((entry) => ({
        word: entry.word,
        reading: entry.reading ?? undefined,
        glosses: entry.glosses ?? undefined,
        partOfSpeech: entry.partOfSpeech ?? undefined,
        jlptLevel: entry.jlptLevel == null ? undefined : clamp(entry.jlptLevel, 1, 5),
      })),
      sentencesPerWord: perWord,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = getApiErrorMessage(body, "Could not generate sentences.");
    if ((body as { code?: string } | null)?.code === "quota_exceeded") {
      throw new ContextSentenceQuotaError(message);
    }
    throw new Error(message);
  }

  // Re-filtered here too: the renderer slices sentences by the target surface, so
  // an unplayable one must never reach it, whatever the server returned.
  const result = filterPlayableSentences(
    (body as { result?: unknown } | null)?.result,
    trimmed.map((entry) => entry.word),
    perWord,
  );
  if (result.items.length === 0) {
    throw new Error("Sentence response was malformed.");
  }
  return result;
}
