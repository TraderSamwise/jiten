import * as SQLite from "expo-sqlite";
import { lookupExactJapanese } from "@/db/search";
import { lookupExactName } from "@/db/name-search";
import type { DictEntry, NameEntry } from "@/db/types";
import { deinflect, generateSubstrings } from "./deinflect";
import { toHiragana } from "wanakana";

export type ReaderLookupMode = "word" | "name" | "auto";
export type LookupKind = "word" | "name";
const AUTO_DUAL_SCORE_DELTA = 140;
const AUTO_DUAL_MIN_MATCH_LENGTH = 2;

export interface LookupResult {
  matchedText: string;
  entries: DictEntry[];
  deinflectReasons: string[];
  /** Offset within the sent text window where the match begins (used for highlight positioning) */
  matchStart?: number;
  /** Name matches (only set in name lookup mode) */
  nameMatches?: NameEntry[];
  lookupKind?: LookupKind;
  alternateResults?: LookupResult[];
}

interface CounterHint {
  combinedKanji: string;
  reading: string;
}

const DIGIT_TO_KANJI: Record<string, string> = {
  "0": "〇",
  "\uff10": "〇",
  "1": "一",
  "\uff11": "一",
  "2": "二",
  "\uff12": "二",
  "3": "三",
  "\uff13": "三",
  "4": "四",
  "\uff14": "四",
  "5": "五",
  "\uff15": "五",
  "6": "六",
  "\uff16": "六",
  "7": "七",
  "\uff17": "七",
  "8": "八",
  "\uff18": "八",
  "9": "九",
  "\uff19": "九",
};

function asWordLookupResult(result: LookupResult): LookupResult {
  return { ...result, lookupKind: "word" };
}

function asNameLookupResult(result: LookupResult): LookupResult {
  return { ...result, lookupKind: "name" };
}

function normalizeDigitsToKanji(text: string): string {
  return text.replace(/[0-9\uff10-\uff19]/g, (ch) => DIGIT_TO_KANJI[ch] ?? ch);
}

function isCounterSurfaceMatch(entry: DictEntry, hint: CounterHint): boolean {
  return (
    entry.kanji.some((kanji) => kanji.text === hint.combinedKanji) ||
    entry.kana.some((kana) => kana.text === hint.reading)
  );
}

function scoreCounterHint(result: LookupResult, hint: CounterHint | null | undefined): number {
  if (!hint) return 0;
  return result.entries.some((entry) => isCounterSurfaceMatch(entry, hint)) ? 420 : 0;
}

async function buildCounterHintMap(
  surfaces: string[],
  extDb?: SQLite.SQLiteDatabase | null,
): Promise<Map<string, CounterHint>> {
  const hints = new Map<string, CounterHint>();
  if (!extDb || surfaces.length === 0) return hints;

  const normalizedSurfaces = [...new Set(surfaces.map(normalizeDigitsToKanji))];
  const hiraganaSurfaces = [...new Set(surfaces.map((surface) => toHiragana(surface)))];
  if (normalizedSurfaces.length === 0 || hiraganaSurfaces.length === 0) return hints;

  const placeholdersKanji = normalizedSurfaces.map(() => "?").join(",");
  const placeholdersReading = hiraganaSurfaces.map(() => "?").join(",");
  type CounterHintRow = { combined_kanji: string; reading: string };
  const rows = await extDb.getAllAsync<CounterHintRow>(
    `SELECT DISTINCT combined_kanji, reading
       FROM counter_readings
      WHERE combined_kanji IN (${placeholdersKanji})
         OR reading IN (${placeholdersReading})`,
    [...normalizedSurfaces, ...hiraganaSurfaces],
  );

  for (const surface of surfaces) {
    const normalized = normalizeDigitsToKanji(surface);
    const hiragana = toHiragana(surface);
    const row =
      rows.find((candidate) => candidate.combined_kanji === normalized) ??
      rows.find((candidate) => candidate.reading === hiragana);
    if (!row) continue;
    hints.set(surface, {
      combinedKanji: row.combined_kanji,
      reading: row.reading,
    });
  }

  return hints;
}

function hasKana(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) return true;
  }
  return false;
}

function hasKanji(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff)
    ) {
      return true;
    }
  }
  return false;
}

function isKanaChar(ch?: string): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0)!;
  return (c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff);
}

function isKanjiChar(ch?: string): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)
  );
}

function topWordExactSurfaceMatch(result: LookupResult): boolean {
  return result.entries.some(
    (entry) =>
      entry.kanji.some((k) => k.text === result.matchedText) ||
      entry.kana.some((k) => k.text === result.matchedText),
  );
}

function topNameExactSurfaceMatch(result: LookupResult): boolean {
  return (
    result.nameMatches?.some(
      (name) => name.kanji === result.matchedText || name.kana === result.matchedText,
    ) ?? false
  );
}

function hasExactKanjiSurfaceMatch(result: LookupResult, sourceText: string): boolean {
  return result.entries.some((entry) => entry.kanji.some((k) => k.text === sourceText));
}

function hasExactKanaSurfaceMatch(result: LookupResult, sourceText: string): boolean {
  return result.entries.some((entry) => entry.kana.some((k) => k.text === sourceText));
}

function tapCandidateStartsAtKanaToKanjiBoundary(text: string, start: number): boolean {
  if (start <= 0 || start >= text.length) return false;
  return isKanaChar(text[start - 1]) && isKanjiChar(text[start]);
}

function tapCandidateStartsAtKanaRunStart(text: string, start: number): boolean {
  if (!isKanaChar(text[start])) return false;
  return start === 0 || !isKanaChar(text[start - 1]);
}

function tapCandidateStartsMidKanaRun(text: string, start: number): boolean {
  if (!isKanaChar(text[start])) return false;
  return start > 0 && isKanaChar(text[start - 1]);
}

function tapCandidateStartsMidKanjiRun(text: string, start: number): boolean {
  if (!isKanjiChar(text[start])) return false;
  return start > 0 && isKanjiChar(text[start - 1]);
}

function tapCandidateEndsMidKanjiRun(text: string, start: number, matchedText: string): boolean {
  const end = start + matchedText.length - 1;
  if (end < 0 || end >= text.length) return false;
  if (!isKanjiChar(text[end])) return false;
  return end < text.length - 1 && isKanjiChar(text[end + 1]);
}

function hasExactSurfaceMatch(result: LookupResult): boolean {
  return (
    hasExactKanjiSurfaceMatch(result, result.matchedText) ||
    hasExactKanaSurfaceMatch(result, result.matchedText)
  );
}

function strictlyContainsCandidate(
  outerStart: number,
  outerMatchedText: string,
  innerStart: number,
  innerMatchedText: string,
): boolean {
  const outerEnd = outerStart + outerMatchedText.length;
  const innerEnd = innerStart + innerMatchedText.length;
  return outerStart <= innerStart && outerEnd >= innerEnd && outerMatchedText !== innerMatchedText;
}

function shouldPreferContainingExactCandidate(
  outerResult: LookupResult,
  outerStart: number,
  innerResult: LookupResult,
  innerStart: number,
): boolean {
  if (!hasExactSurfaceMatch(outerResult) || !hasExactSurfaceMatch(innerResult)) return false;
  if (
    !strictlyContainsCandidate(
      outerStart,
      outerResult.matchedText,
      innerStart,
      innerResult.matchedText,
    )
  ) {
    return false;
  }

  // Kana-only run extensions remain ambiguous overlap cases and should
  // still be handled by the structural scorer rather than auto-winning.
  return hasKanji(outerResult.matchedText);
}

function scoreTapCandidate(
  text: string,
  tapOffset: number,
  result: LookupResult,
  start: number,
  hasCommon: boolean,
): number {
  let score = result.matchedText.length * 100;
  const isKanaOnly = hasKana(result.matchedText) && !hasKanji(result.matchedText);
  const suffixCharsAfterTap = start + result.matchedText.length - 1 - tapOffset;

  if (hasExactKanjiSurfaceMatch(result, result.matchedText)) score += 160;
  else if (hasExactKanaSurfaceMatch(result, result.matchedText)) score += 45;

  if (tapCandidateStartsAtKanaToKanjiBoundary(text, start)) score += 120;
  else if (tapCandidateStartsAtKanaRunStart(text, start)) score += 50;
  else if (tapCandidateStartsMidKanaRun(text, start)) score -= 65;

  if (tapCandidateStartsMidKanjiRun(text, start)) score -= 140;
  if (tapCandidateEndsMidKanjiRun(text, start, result.matchedText)) score -= 140;
  if (hasCommon) score += 120;
  if (result.deinflectReasons.length > 0) score -= 20;
  if (isKanaOnly && suffixCharsAfterTap > 0) {
    score -= suffixCharsAfterTap * 30;
  }

  // Small fallback toward candidates that extend backward from the tap
  // rather than starting strictly after it.
  if (start < tapOffset) score += 8;

  return score;
}

function scoreWordResult(result: LookupResult): number {
  if (result.entries.length === 0) return Number.NEGATIVE_INFINITY;

  const commonCount = result.entries.filter((entry) => entry.common).length;
  let score = result.matchedText.length * 1000;
  score += commonCount * 120;
  score += result.entries.length > 0 ? 20 : 0;

  if (topWordExactSurfaceMatch(result)) score += 260;
  if (result.deinflectReasons.length > 0) score -= 80;

  const matched = result.matchedText;
  if (hasKanji(matched) && hasKana(matched)) score += 120;
  if (hasKana(matched) && !hasKanji(matched)) score += 30;

  return score;
}

function scoreNameResult(result: LookupResult): number {
  const names = result.nameMatches ?? [];
  if (names.length === 0) return Number.NEGATIVE_INFINITY;

  let score = result.matchedText.length * 1000;
  score += topNameExactSurfaceMatch(result) ? 260 : 0;
  score += names.filter((name) => !!name.translation).length * 25;

  const strongTypes = new Set([
    "surname",
    "given",
    "fem",
    "masc",
    "person",
    "place",
    "station",
    "organization",
    "company",
    "product",
  ]);
  const topType = names[0]?.nameType;
  if (topType && strongTypes.has(topType)) score += 90;
  if (topType === "unclass") score -= 25;

  if (hasKanji(result.matchedText) && !hasKana(result.matchedText)) score += 80;
  if (names.length > 4) score -= Math.min(names.length - 4, 6) * 10;

  return score;
}

function shouldShowBothAutoResults(
  bestWord: LookupResult,
  bestName: LookupResult,
  wordScore: number,
  nameScore: number,
): boolean {
  if (bestWord.matchedText !== bestName.matchedText) return false;
  if (bestWord.matchedText.length < AUTO_DUAL_MIN_MATCH_LENGTH) return false;
  if (!topWordExactSurfaceMatch(bestWord) || !topNameExactSurfaceMatch(bestName)) return false;
  return Math.abs(wordScore - nameScore) <= AUTO_DUAL_SCORE_DELTA;
}

function chooseAutoLookupVariants(
  wordResult: LookupResult,
  nameResults: LookupResult[],
): LookupResult[] {
  const taggedWord = asWordLookupResult(wordResult);
  if (nameResults.length === 0) return [taggedWord];

  const taggedNames = nameResults.map(asNameLookupResult);
  const bestName = taggedNames[0];
  const wordScore = scoreWordResult(taggedWord);
  const nameScore = scoreNameResult(bestName);

  if (bestName.matchedText.length > taggedWord.matchedText.length) return taggedNames;
  if (bestName.matchedText.length < taggedWord.matchedText.length) return [taggedWord];

  if (shouldShowBothAutoResults(taggedWord, bestName, wordScore, nameScore)) {
    return [taggedWord, bestName];
  }

  return wordScore >= nameScore ? [taggedWord] : [bestName];
}

function attachAutoSelectionAlternates(
  wordResults: LookupResult[],
  nameMatchesByText: Map<string, LookupResult[]>,
): LookupResult[] {
  return wordResults.map((result) => {
    const variants = chooseAutoLookupVariants(
      result,
      nameMatchesByText.get(result.matchedText) ?? [],
    );
    if (variants.length <= 1) return variants[0];
    return {
      ...variants[0],
      alternateResults: variants,
    };
  });
}

export function chooseAutoLookupResults(
  wordResults: LookupResult[],
  nameResults: LookupResult[],
): LookupResult[] {
  const taggedWordResults = wordResults.map(asWordLookupResult);
  const taggedNameResults = nameResults.map(asNameLookupResult);

  if (taggedWordResults.length === 0) return taggedNameResults;
  if (taggedNameResults.length === 0) return taggedWordResults;

  const variants = chooseAutoLookupVariants(taggedWordResults[0], taggedNameResults);
  if (variants.length <= 1) {
    return variants[0]?.lookupKind === "name" ? taggedNameResults : taggedWordResults;
  }
  return [
    {
      ...variants[0],
      alternateResults: variants,
    },
  ];
}

/**
 * Lookup for user-selected text: walks through the entire selection,
 * finding each word and advancing past it. Calls onResult as each
 * word is found so the UI can update progressively.
 *
 * When prefix/suffix are provided, first tries expanding the selection
 * boundaries to find longer dictionary matches that span beyond the
 * user's selection (e.g., selecting 色い when 茶色い is the real word).
 */
export async function selectionLookup(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  onResult: (result: LookupResult) => void,
  options?: { prefix?: string; suffix?: string; extendedDb?: SQLite.SQLiteDatabase | null },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const prefix = options?.prefix || "";
  const suffix = options?.suffix || "";
  const expandedForHints = prefix + trimmed + suffix;
  const counterHints = await buildCounterHintMap(
    generateSubstrings(expandedForHints, Math.min(expandedForHints.length, 20)),
    options?.extendedDb,
  );

  // Expansion step: try substrings of expanded text that fully contain the selection
  if (prefix.length > 0 || suffix.length > 0) {
    const expanded = prefix + trimmed + suffix;
    const selStart = prefix.length;
    const selEnd = prefix.length + trimmed.length;

    // Try substrings longest-first that fully contain the original selection
    for (let len = Math.min(expanded.length, 20); len > trimmed.length; len--) {
      // Valid starts: must include [selStart, selEnd), so start <= selStart and start+len >= selEnd
      const minStart = Math.max(0, selEnd - len);
      const maxStart = Math.min(selStart, expanded.length - len);
      for (let start = minStart; start <= maxStart; start++) {
        const substr = expanded.slice(start, start + len);
        const candidates = deinflect(substr);

        let best: LookupResult | null = null;
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const candidate of candidates) {
          const entries = await lookupExactJapanese(dictDb, candidate.word);
          if (entries.length > 0) {
            const hasCommon = entries.some((e) => e.common);
            const result: LookupResult = {
              matchedText: substr,
              entries,
              deinflectReasons: candidate.reasons,
            };
            const score =
              (hasCommon ? 100 : 0) +
              scoreCounterHint(result, counterHints.get(substr)) -
              candidate.reasons.length * 5;
            if (!best || score > bestScore) {
              best = result;
              bestScore = score;
            }
          }
        }

        if (best) {
          onResult(asWordLookupResult(best));
          return;
        }
      }
    }
  }

  // Try the full selected text as a single lookup first
  const fullEntries = await lookupExactJapanese(dictDb, trimmed);
  if (fullEntries.length > 0) {
    onResult(
      asWordLookupResult({
        matchedText: trimmed,
        entries: fullEntries,
        deinflectReasons: [],
      }),
    );
    return;
  }

  // Try deinflecting the full selected text
  const fullCandidates = deinflect(trimmed);
  for (const candidate of fullCandidates) {
    if (candidate.word === trimmed) continue; // already tried exact
    const entries = await lookupExactJapanese(dictDb, candidate.word);
    if (entries.length > 0) {
      onResult(
        asWordLookupResult({
          matchedText: trimmed,
          entries,
          deinflectReasons: candidate.reasons,
        }),
      );
      return;
    }
  }

  // Walk through the selection, finding each word and advancing
  const seenEntryIds = new Set<number>();
  let pos = 0;

  while (pos < trimmed.length) {
    // Skip punctuation and whitespace
    if (/[\s、。「」『』（）\u3000]/.test(trimmed[pos])) {
      pos++;
      continue;
    }

    // At the start, try expanding the first word into the prefix
    if (pos === 0 && prefix.length > 0) {
      const boundaryResult = await findBoundaryWord(
        prefix,
        trimmed.slice(0, 15),
        dictDb,
        seenEntryIds,
        counterHints,
      );
      if (boundaryResult) {
        for (const e of boundaryResult.result.entries) seenEntryIds.add(e.id);
        onResult(asWordLookupResult(boundaryResult.result));
        pos += boundaryResult.selectionCharsConsumed;
        continue;
      }
    }

    const remaining = trimmed.slice(pos);
    // Extend with suffix so words at the end of the selection can be
    // found even when the selection cuts them short (e.g. 姿 → 姿勢)
    const textToSearch = suffix.length > 0 ? remaining + suffix.slice(0, 10) : remaining;
    const wordResult = await findFirstWord(textToSearch, dictDb, seenEntryIds, counterHints);

    if (wordResult) {
      for (const e of wordResult.result.entries) seenEntryIds.add(e.id);
      onResult(asWordLookupResult(wordResult.result));
      pos += Math.min(wordResult.matchLength, remaining.length);
    } else {
      pos++;
    }
  }
}

/** Find the longest matching word at the start of text. */
async function findFirstWord(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  seenEntryIds: Set<number>,
  counterHints: Map<string, CounterHint>,
): Promise<{ result: LookupResult; matchLength: number } | null> {
  const maxLen = Math.min(text.length, 15);
  const substrings = generateSubstrings(text, maxLen);

  for (const substr of substrings) {
    const candidates = deinflect(substr);

    // Try all candidates for this substring length, prefer common entries
    let best: { result: LookupResult; matchLength: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const allEntries = await lookupExactJapanese(dictDb, candidate.word);
      const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

      if (newEntries.length > 0) {
        const hasCommon = newEntries.some((e) => e.common);
        const match = {
          result: {
            matchedText: substr,
            entries: newEntries,
            deinflectReasons: candidate.reasons,
          },
          matchLength: substr.length,
        };
        const score =
          (hasCommon ? 100 : 0) +
          scoreCounterHint(match.result, counterHints.get(substr)) -
          candidate.reasons.length * 5;

        if (!best || score > bestScore) {
          best = match;
          bestScore = score;
        }
      }
    }

    if (best) return best;
  }

  return null;
}

/**
 * Find a word that spans the prefix→selection boundary.
 * Tries substrings that start in the prefix and extend into the selection,
 * longest first, preferring common entries.
 */
async function findBoundaryWord(
  prefix: string,
  selectionStart: string,
  dictDb: SQLite.SQLiteDatabase,
  seenEntryIds: Set<number>,
  counterHints: Map<string, CounterHint>,
): Promise<{ result: LookupResult; selectionCharsConsumed: number } | null> {
  const before = prefix.slice(-10);
  const after = selectionStart.slice(0, 15);
  const combined = before + after;
  const boundary = before.length;

  // Also run the normal findFirstWord on just the selection to compare
  const normalResult = await findFirstWord(selectionStart, dictDb, seenEntryIds, counterHints);

  for (let len = Math.min(combined.length, 15); len >= 2; len--) {
    const minStart = Math.max(0, boundary - len + 1);
    const maxStart = Math.min(boundary - 1, combined.length - len);

    for (let start = maxStart; start >= minStart; start--) {
      // Must extend into the selection
      if (start + len <= boundary) continue;

      const substr = combined.slice(start, start + len);
      const candidates = deinflect(substr);

      let best: LookupResult | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const candidate of candidates) {
        const allEntries = await lookupExactJapanese(dictDb, candidate.word);
        const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

        if (newEntries.length > 0) {
          const hasCommon = newEntries.some((e) => e.common);
          const next: LookupResult = {
            matchedText: substr,
            entries: newEntries,
            deinflectReasons: candidate.reasons,
          };
          const score =
            (hasCommon ? 100 : 0) +
            scoreCounterHint(next, counterHints.get(substr)) -
            candidate.reasons.length * 5;
          if (!best || score > bestScore) {
            best = next;
            bestScore = score;
          }
        }
      }

      if (best) {
        const selChars = start + len - boundary;
        // Only use boundary match if it's at least as long overall as the normal match
        if (normalResult && normalResult.matchLength > selChars) continue;
        return {
          result: best,
          selectionCharsConsumed: selChars,
        };
      }
    }
  }

  return null;
}

/**
 * Full word lookup pipeline: generate candidates from text, search dictionary,
 * deduplicate, and return results ordered by match length.
 */
export async function smartLookup(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  extDb?: SQLite.SQLiteDatabase | null,
): Promise<LookupResult[]> {
  const maxLen = Math.min(text.length, 15);
  const substrings = generateSubstrings(text, maxLen);
  const counterHints = await buildCounterHintMap(substrings, extDb);
  const results: LookupResult[] = [];
  const seenEntryIds = new Set<number>();

  for (const substr of substrings) {
    const candidates = deinflect(substr);

    for (const candidate of candidates) {
      const allEntries = await lookupExactJapanese(dictDb, candidate.word);

      const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

      if (newEntries.length > 0) {
        for (const e of newEntries) seenEntryIds.add(e.id);
        results.push(
          asWordLookupResult({
            matchedText: substr,
            entries: newEntries,
            deinflectReasons: candidate.reasons,
          }),
        );
      }
    }

    // Stop as soon as we find the longest match — no sub-word noise
    if (results.length > 0) break;
  }

  return results;
}

/**
 * Tap lookup with backward context. Tries substrings that contain the
 * tap position, longest first, preferring starts at/near the tap offset.
 *
 * Returns results with `matchStart` indicating where the match begins
 * within the text window (used for highlight positioning).
 */
export async function smartLookupWithOffset(
  text: string,
  tapOffset: number,
  dictDb: SQLite.SQLiteDatabase,
  extDb?: SQLite.SQLiteDatabase | null,
): Promise<LookupResult[]> {
  const tapSurfaces = new Set<string>();
  for (let len = Math.min(text.length, 15); len >= 1; len--) {
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);
    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      tapSurfaces.add(text.slice(start, start + len));
    }
  }
  const counterHints = await buildCounterHintMap([...tapSurfaces], extDb);
  let bestOverall: { result: LookupResult; score: number; length: number; start: number } | null =
    null;

  for (let len = Math.min(text.length, 15); len >= 1; len--) {
    // Valid start positions: substring must contain the tap position
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);
    let bestForLength: {
      result: LookupResult;
      score: number;
      length: number;
      start: number;
    } | null = null;

    // Iterate starts from tapOffset downward (prefer word starting at/near tap)
    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      const substr = text.slice(start, start + len);
      const candidates = deinflect(substr);

      for (const candidate of candidates) {
        const entries = await lookupExactJapanese(dictDb, candidate.word);
        if (entries.length > 0) {
          const hasCommon = entries.some((e) => e.common);
          const result: LookupResult = {
            matchedText: substr,
            entries,
            deinflectReasons: candidate.reasons,
            matchStart: start,
          };
          const score =
            scoreTapCandidate(text, tapOffset, result, start, hasCommon) +
            scoreCounterHint(result, counterHints.get(substr));
          if (!bestForLength || score > bestForLength.score) {
            bestForLength = { result, score, length: len, start };
          }
        }
      }
    }

    if (!bestForLength) continue;
    if (!bestOverall) {
      bestOverall = bestForLength;
      continue;
    }

    const currentContainsBest = shouldPreferContainingExactCandidate(
      bestForLength.result,
      bestForLength.start,
      bestOverall.result,
      bestOverall.start,
    );
    if (currentContainsBest) {
      bestOverall = bestForLength;
      continue;
    }

    const bestContainsCurrent = shouldPreferContainingExactCandidate(
      bestOverall.result,
      bestOverall.start,
      bestForLength.result,
      bestForLength.start,
    );
    if (bestContainsCurrent) continue;

    const lengthDiff = bestOverall.length - bestForLength.length;
    if (lengthDiff >= 2) break;
    if (lengthDiff <= -2) {
      bestOverall = bestForLength;
      continue;
    }

    if (bestForLength.score > bestOverall.score) {
      bestOverall = bestForLength;
    }
  }

  return bestOverall ? [asWordLookupResult(bestOverall.result)] : [];
}

export async function autoLookup(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  extDb?: SQLite.SQLiteDatabase | null,
): Promise<LookupResult[]> {
  const [wordResults, nameResults] = await Promise.all([
    smartLookup(text, dictDb, extDb),
    extDb ? nameLookup(text, extDb) : Promise.resolve([]),
  ]);
  return chooseAutoLookupResults(wordResults, nameResults);
}

export async function autoLookupWithOffset(
  text: string,
  tapOffset: number,
  dictDb: SQLite.SQLiteDatabase,
  extDb?: SQLite.SQLiteDatabase | null,
): Promise<LookupResult[]> {
  const [wordResults, nameResults] = await Promise.all([
    smartLookupWithOffset(text, tapOffset, dictDb, extDb),
    extDb ? nameLookupWithOffset(text, tapOffset, extDb) : Promise.resolve([]),
  ]);
  return chooseAutoLookupResults(wordResults, nameResults);
}

export async function autoSelectionLookup(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  extDb: SQLite.SQLiteDatabase | null | undefined,
  options?: { prefix?: string; suffix?: string },
): Promise<LookupResult[]> {
  const wordResults: LookupResult[] = [];
  await selectionLookup(
    text,
    dictDb,
    (result) => {
      wordResults.push(result);
    },
    { ...options, extendedDb: extDb },
  );

  if (wordResults.length === 0) {
    return extDb ? nameLookup(text, extDb) : [];
  }

  if (!extDb) {
    return wordResults.map(asWordLookupResult);
  }

  const uniqueTexts = [...new Set(wordResults.map((result) => result.matchedText))];
  const nameLookups = await Promise.all(
    uniqueTexts.map((matchedText) => nameLookup(matchedText, extDb)),
  );
  const nameMatchesByText = new Map<string, LookupResult[]>();
  uniqueTexts.forEach((matchedText, index) => {
    nameMatchesByText.set(matchedText, nameLookups[index]);
  });

  return attachAutoSelectionAlternates(wordResults, nameMatchesByText);
}

// ---------------------------------------------------------------------------
// Name-mode lookups (used when user toggles to "Names" mode in reader)
// Same greedy longest-first strategy, but exact name match only (no deinflection).
// ---------------------------------------------------------------------------

/** Tap-based name lookup: greedy longest-first match containing the tap position. */
export async function nameLookupWithOffset(
  text: string,
  tapOffset: number,
  extDb: SQLite.SQLiteDatabase,
): Promise<LookupResult[]> {
  for (let len = Math.min(text.length, 15); len >= 1; len--) {
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);

    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      const substr = text.slice(start, start + len);
      const names = await lookupExactName(extDb, substr);
      if (names.length > 0) {
        return [
          asNameLookupResult({
            matchedText: substr,
            entries: [],
            deinflectReasons: [],
            matchStart: start,
            nameMatches: names,
          }),
        ];
      }
    }
  }
  return [];
}

/**
 * Decompose a compound word into sub-words, maximizing the number of common entries.
 * Uses DP over all valid partitions (word length is small, typically ≤10 chars).
 * Returns [] if the word can't be split into 2+ parts.
 */
export async function decomposeWord(
  word: string,
  dictDb: SQLite.SQLiteDatabase,
): Promise<LookupResult[]> {
  if (word.length < 2 || word.length > 20) return [];
  const maxMatchLen = word.length - 1;
  const n = word.length;

  // Precompute: for each position, find all possible sub-word matches starting there
  const matchesAt: Map<number, { len: number; result: LookupResult; isCommon: boolean }[]> =
    new Map();

  for (let pos = 0; pos < n; pos++) {
    const remaining = word.slice(pos);
    const tryLen = Math.min(remaining.length, maxMatchLen, 15);
    const hits: { len: number; result: LookupResult; isCommon: boolean }[] = [];

    for (let len = 1; len <= tryLen; len++) {
      const substr = remaining.slice(0, len);
      const candidates = deinflect(substr);

      let best: LookupResult | null = null;
      let bestCommon = false;

      for (const candidate of candidates) {
        const entries = await lookupExactJapanese(dictDb, candidate.word);
        if (entries.length > 0) {
          const hasCommon = entries.some((e) => e.common);
          if (!best || (hasCommon && !bestCommon)) {
            best = { matchedText: substr, entries, deinflectReasons: candidate.reasons };
            bestCommon = hasCommon;
          }
        }
      }

      if (best) {
        hits.push({ len, result: best, isCommon: bestCommon });
      }
    }

    matchesAt.set(pos, hits);
  }

  // DP: dp[pos] = best partition of word[pos..n]
  // Score: fewest parts first, then most common words as tiebreaker
  const dp: (null | { partCount: number; commonCount: number; parts: LookupResult[] })[] =
    new Array(n + 1).fill(null);
  dp[n] = { partCount: 0, commonCount: 0, parts: [] };

  for (let pos = n - 1; pos >= 0; pos--) {
    const hits = matchesAt.get(pos) ?? [];
    for (const hit of hits) {
      const next = dp[pos + hit.len];
      if (!next) continue;
      const partCount = next.partCount + 1;
      const commonCount = next.commonCount + (hit.isCommon ? 1 : 0);
      const better =
        !dp[pos] ||
        partCount < dp[pos]!.partCount ||
        (partCount === dp[pos]!.partCount && commonCount > dp[pos]!.commonCount);
      if (better) {
        dp[pos] = { partCount, commonCount, parts: [hit.result, ...next.parts] };
      }
    }
  }

  const best = dp[0];
  return best && best.parts.length >= 2 ? best.parts : [];
}

/** Simple name lookup: greedy longest-first match from start of text. */
export async function nameLookup(
  text: string,
  extDb: SQLite.SQLiteDatabase,
): Promise<LookupResult[]> {
  const substrings = generateSubstrings(text, Math.min(text.length, 15));
  for (const substr of substrings) {
    const names = await lookupExactName(extDb, substr);
    if (names.length > 0) {
      return [
        asNameLookupResult({
          matchedText: substr,
          entries: [],
          deinflectReasons: [],
          nameMatches: names,
        }),
      ];
    }
  }
  return [];
}
