/**
 * Confused-words detection for SRS review.
 *
 * When a user repeatedly fails a word, checks whether they might be
 * confusing it with a visually similar word in the same list.
 *
 * Pure functions (isKanji, getKanaTemplate, etc.) are tested directly.
 * findConfusedWords takes DB query functions as parameters to avoid
 * importing @/db modules (which need path aliases unavailable in vitest).
 */

/** Check if a character is a CJK Unified Ideograph (kanji). */
export function isKanji(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df)
  );
}

export interface KanaTemplate {
  template: string[];
  kanjiPositions: number[];
}

/**
 * Split a word into a kana template.
 * Each position is either "K" (kanji) or the literal kana character.
 * Returns null if the word has no kanji.
 */
export function getKanaTemplate(word: string): KanaTemplate | null {
  const chars = [...word];
  const template: string[] = [];
  const kanjiPositions: number[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (isKanji(chars[i])) {
      template.push("K");
      kanjiPositions.push(i);
    } else {
      template.push(chars[i]);
    }
  }

  if (kanjiPositions.length === 0) return null;
  return { template, kanjiPositions };
}

/**
 * Check if a word matches a kana template:
 * same length, identical kana at each position, any kanji at "K" positions.
 */
export function matchesKanaTemplate(word: string, template: string[]): boolean {
  const chars = [...word];
  if (chars.length !== template.length) return false;

  for (let i = 0; i < template.length; i++) {
    if (template[i] === "K") {
      if (!isKanji(chars[i])) return false;
    } else {
      if (chars[i] !== template[i]) return false;
    }
  }
  return true;
}

/** Returns true if a card's fail ratio warrants confusion checking. */
export function shouldCheckConfusion(reps: number, lapses: number): boolean {
  return reps >= 5 && lapses / reps > 0.4;
}

/** A single kanji-position match between two words. */
export interface KanjiPositionMatch {
  position: number;
  failedKanji: string;
  candidateKanji: string;
  similarity: number;
}

/** A confused word result with per-position match details. */
export interface ConfusedWordResult {
  entry: { id: number; kanji: { text: string }[]; [key: string]: any };
  matches: KanjiPositionMatch[];
  bestSimilarity: number;
}

/** Minimal interface for entries used by findConfusedWords. */
export interface EntryLike {
  id: number;
  kanji: { text: string }[];
  [key: string]: any;
}

/** Minimal interface for similar kanji results. */
interface SimilarKanjiLike {
  literal: string;
  score: number;
}

/**
 * Find words in the same list that might be confused with the failed word
 * due to visually similar kanji.
 *
 * DB functions are passed as parameters to keep this module free of
 * @/db imports (which require path aliases).
 */
export async function findConfusedWords(
  failedEntry: EntryLike,
  listEntryIds: number[],
  getSimilarKanji: (literal: string, limit: number) => Promise<SimilarKanjiLike[]>,
  getEntries: (entryIds: number[]) => Promise<EntryLike[]>,
): Promise<ConfusedWordResult[]> {
  const kanjiText = failedEntry.kanji[0]?.text;
  if (!kanjiText) return [];

  const tmpl = getKanaTemplate(kanjiText);
  if (!tmpl) return [];

  const failedChars = [...kanjiText];

  // For each kanji position, get similar kanji with scores
  const similarByPosition = new Map<number, Map<string, number>>();
  for (const pos of tmpl.kanjiPositions) {
    const similar = await getSimilarKanji(failedChars[pos], 10);
    const map = new Map<string, number>();
    for (const s of similar) {
      map.set(s.literal, s.score);
    }
    similarByPosition.set(pos, map);
  }

  // Load candidate entries
  const candidates = await getEntries(listEntryIds);

  const results: ConfusedWordResult[] = [];

  for (const candidate of candidates) {
    const candKanji = candidate.kanji[0]?.text;
    if (!candKanji) continue;
    if (!matchesKanaTemplate(candKanji, tmpl.template)) continue;

    const candChars = [...candKanji];
    const matches: KanjiPositionMatch[] = [];

    for (const pos of tmpl.kanjiPositions) {
      const candChar = candChars[pos];
      if (candChar === failedChars[pos]) continue; // same kanji, not confused
      const simMap = similarByPosition.get(pos);
      if (!simMap) continue;
      const score = simMap.get(candChar);
      if (score != null) {
        matches.push({
          position: pos,
          failedKanji: failedChars[pos],
          candidateKanji: candChar,
          similarity: score,
        });
      }
    }

    if (matches.length > 0) {
      results.push({
        entry: candidate,
        matches,
        bestSimilarity: Math.max(...matches.map((m) => m.similarity)),
      });
    }
  }

  results.sort((a, b) => b.bestSimilarity - a.bestSimilarity);
  return results;
}

// ─── Meaning-based confusion detection ───

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "is",
  "be",
  "do",
  "it",
  "or",
  "as",
  "by",
  "up",
  "no",
  "so",
  "if",
  "my",
  "we",
  "he",
  "me",
  "us",
  "am",
  "for",
  "and",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "are",
  "has",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "let",
  "say",
  "she",
  "too",
  "use",
  "with",
  "from",
  "that",
  "this",
  "have",
  "been",
  "make",
  "more",
  "some",
  "very",
  "when",
  "what",
  "your",
  "them",
  "then",
  "than",
  "each",
  "which",
  "will",
  "into",
  "just",
  "also",
  "over",
  "such",
  "only",
  "etc",
  "esp",
]);

/** Extract meaningful English tokens from an entry's glosses. */
export function extractGlossTokens(entry: {
  senses?: { glosses?: { lang: string; text: string }[] }[];
}): Set<string> {
  const tokens = new Set<string>();
  if (!entry.senses) return tokens;

  for (const sense of entry.senses) {
    if (!sense.glosses) continue;
    for (const gloss of sense.glosses) {
      if (gloss.lang !== "eng") continue;
      const words = gloss.text.toLowerCase().split(/[\s\-\/\(\),;:.!?'"]+/);
      for (const w of words) {
        if (w.length >= 2 && !STOP_WORDS.has(w)) {
          tokens.add(w);
        }
      }
    }
  }

  return tokens;
}

/** Jaccard similarity: |intersection| / |union| */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  if (intersection === 0) return 0;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/** Result of meaning confusion detection */
export interface MeaningConfusionResult {
  entry: EntryLike & { senses?: any[] };
  similarity: number;
  sharedTokens: string[];
}

/** Find entries with similar English meanings to the failed entry. */
export function findMeaningConfusion(
  failedEntry: EntryLike & { senses?: any[] },
  candidates: (EntryLike & { senses?: any[] })[],
  threshold = 0.25,
): MeaningConfusionResult[] {
  const failedTokens = extractGlossTokens(failedEntry);
  if (failedTokens.size === 0) return [];

  const results: MeaningConfusionResult[] = [];

  for (const candidate of candidates) {
    if (candidate.id === failedEntry.id) continue;

    const candTokens = extractGlossTokens(candidate);
    const similarity = jaccardSimilarity(failedTokens, candTokens);

    if (similarity >= threshold) {
      const sharedTokens: string[] = [];
      for (const t of failedTokens) {
        if (candTokens.has(t)) sharedTokens.push(t);
      }
      results.push({ entry: candidate, similarity, sharedTokens });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, 3);
}

// ─── Reading-based confusion detection ───

function toHira(s: string): string {
  return s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function norm(s: string): string {
  return s.normalize("NFC");
}

export async function findReadingConfusion(
  failedEntryId: number,
  typedKana: string,
  listEntryIds: number[],
  getEntries: (ids: number[]) => Promise<EntryLike[]>,
): Promise<EntryLike | null> {
  const normalizedTyped = toHira(norm(typedKana));
  if (!normalizedTyped || normalizedTyped.length < 2) return null;

  const otherIds = listEntryIds.filter((id) => id !== failedEntryId);
  if (otherIds.length === 0) return null;
  const candidates = await getEntries(otherIds);

  for (const candidate of candidates) {
    const kana = candidate.kana ?? candidate.kanji ?? [];
    const readings = Array.isArray(kana) ? kana.map((k: any) => k.text) : [];
    if (readings.some((r: string) => toHira(norm(r)) === normalizedTyped)) {
      return candidate;
    }
  }
  return null;
}
