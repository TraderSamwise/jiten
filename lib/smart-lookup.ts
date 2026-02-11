import * as SQLite from "expo-sqlite";
import { lookupExactJapanese } from "@/db/search";
import type { DictEntry } from "@/db/types";
import { deinflect, generateSubstrings } from "./deinflect";

export interface LookupResult {
  matchedText: string;
  entries: DictEntry[];
  deinflectReasons: string[];
  /** Offset within the sent text window where the match begins (used for highlight positioning) */
  matchStart?: number;
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
  options?: { prefix?: string; suffix?: string },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Expansion step: try substrings of expanded text that fully contain the selection
  const prefix = options?.prefix || "";
  const suffix = options?.suffix || "";
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
        let bestCommon = false;

        for (const candidate of candidates) {
          const entries = await lookupExactJapanese(dictDb, candidate.word);
          if (entries.length > 0) {
            const hasCommon = entries.some((e) => e.common);
            const result: LookupResult = {
              matchedText: substr,
              entries,
              deinflectReasons: candidate.reasons,
            };
            if (!best || (hasCommon && !bestCommon)) {
              best = result;
              bestCommon = hasCommon;
            }
          }
        }

        if (best) {
          onResult(best);
          return;
        }
      }
    }
  }

  // Try the full selected text as a single lookup first
  const fullEntries = await lookupExactJapanese(dictDb, trimmed);
  if (fullEntries.length > 0) {
    onResult({
      matchedText: trimmed,
      entries: fullEntries,
      deinflectReasons: [],
    });
    return;
  }

  // Try deinflecting the full selected text
  const fullCandidates = deinflect(trimmed);
  for (const candidate of fullCandidates) {
    if (candidate.word === trimmed) continue; // already tried exact
    const entries = await lookupExactJapanese(dictDb, candidate.word);
    if (entries.length > 0) {
      onResult({
        matchedText: trimmed,
        entries,
        deinflectReasons: candidate.reasons,
      });
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
      );
      if (boundaryResult) {
        for (const e of boundaryResult.result.entries) seenEntryIds.add(e.id);
        onResult(boundaryResult.result);
        pos += boundaryResult.selectionCharsConsumed;
        continue;
      }
    }

    const remaining = trimmed.slice(pos);
    // Extend with suffix so words at the end of the selection can be
    // found even when the selection cuts them short (e.g. 姿 → 姿勢)
    const textToSearch = suffix.length > 0 ? remaining + suffix.slice(0, 10) : remaining;
    const wordResult = await findFirstWord(textToSearch, dictDb, seenEntryIds);

    if (wordResult) {
      for (const e of wordResult.result.entries) seenEntryIds.add(e.id);
      onResult(wordResult.result);
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
): Promise<{ result: LookupResult; matchLength: number } | null> {
  const maxLen = Math.min(text.length, 15);
  const substrings = generateSubstrings(text, maxLen);

  for (const substr of substrings) {
    const candidates = deinflect(substr);

    // Try all candidates for this substring length, prefer common entries
    let best: { result: LookupResult; matchLength: number } | null = null;
    let bestCommon = false;

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

        if (!best || (hasCommon && !bestCommon)) {
          best = match;
          bestCommon = hasCommon;
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
): Promise<{ result: LookupResult; selectionCharsConsumed: number } | null> {
  const before = prefix.slice(-10);
  const after = selectionStart.slice(0, 15);
  const combined = before + after;
  const boundary = before.length;

  // Also run the normal findFirstWord on just the selection to compare
  const normalResult = await findFirstWord(selectionStart, dictDb, seenEntryIds);

  for (let len = Math.min(combined.length, 15); len >= 2; len--) {
    const minStart = Math.max(0, boundary - len + 1);
    const maxStart = Math.min(boundary - 1, combined.length - len);

    for (let start = maxStart; start >= minStart; start--) {
      // Must extend into the selection
      if (start + len <= boundary) continue;

      const substr = combined.slice(start, start + len);
      const candidates = deinflect(substr);

      let best: LookupResult | null = null;
      let bestCommon = false;

      for (const candidate of candidates) {
        const allEntries = await lookupExactJapanese(dictDb, candidate.word);
        const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

        if (newEntries.length > 0) {
          const hasCommon = newEntries.some((e) => e.common);
          if (!best || (hasCommon && !bestCommon)) {
            best = {
              matchedText: substr,
              entries: newEntries,
              deinflectReasons: candidate.reasons,
            };
            bestCommon = hasCommon;
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
): Promise<LookupResult[]> {
  const maxLen = Math.min(text.length, 15);
  const substrings = generateSubstrings(text, maxLen);
  const results: LookupResult[] = [];
  const seenEntryIds = new Set<number>();

  for (const substr of substrings) {
    const candidates = deinflect(substr);

    for (const candidate of candidates) {
      const allEntries = await lookupExactJapanese(dictDb, candidate.word);

      const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

      if (newEntries.length > 0) {
        for (const e of newEntries) seenEntryIds.add(e.id);
        results.push({
          matchedText: substr,
          entries: newEntries,
          deinflectReasons: candidate.reasons,
        });
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
): Promise<LookupResult[]> {
  for (let len = Math.min(text.length, 15); len >= 1; len--) {
    // Valid start positions: substring must contain the tap position
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);

    // Iterate starts from tapOffset downward (prefer word starting at/near tap)
    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      const substr = text.slice(start, start + len);
      const candidates = deinflect(substr);

      // Try all candidates for this position, prefer common entries
      let best: LookupResult | null = null;
      let bestCommon = false;

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

          if (!best || (hasCommon && !bestCommon)) {
            best = result;
            bestCommon = hasCommon;
          }
        }
      }

      if (best) return [best];
    }
  }

  return [];
}
