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
        for (const candidate of candidates) {
          const entries = await lookupExactJapanese(dictDb, candidate.word);
          if (entries.length > 0) {
            onResult({
              matchedText: substr,
              entries,
              deinflectReasons: candidate.reasons,
            });
            return;
          }
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

    const remaining = trimmed.slice(pos);
    const wordResult = await findFirstWord(remaining, dictDb, seenEntryIds);

    if (wordResult) {
      for (const e of wordResult.result.entries) seenEntryIds.add(e.id);
      onResult(wordResult.result);
      pos += wordResult.matchLength;
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

    for (const candidate of candidates) {
      const allEntries = await lookupExactJapanese(dictDb, candidate.word);
      const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

      if (newEntries.length > 0) {
        return {
          result: {
            matchedText: substr,
            entries: newEntries,
            deinflectReasons: candidate.reasons,
          },
          matchLength: substr.length,
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

    // Stop once we have results and we've gone a couple chars shorter
    const currentLen = substr.length;
    if (results.length > 0 && currentLen < maxLen - 2) break;
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
  const results: LookupResult[] = [];
  const seenEntryIds = new Set<number>();
  let foundAtLen = -1;

  for (let len = Math.min(text.length, 15); len >= 1; len--) {
    // Early termination: once results found, continue 2 more lengths then stop
    if (foundAtLen > 0 && len < foundAtLen - 2) break;

    // Valid start positions: substring must contain the tap position
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);

    // Iterate starts from tapOffset downward (prefer word starting at/near tap)
    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      const substr = text.slice(start, start + len);
      const candidates = deinflect(substr);

      for (const candidate of candidates) {
        const allEntries = await lookupExactJapanese(dictDb, candidate.word);
        const newEntries = allEntries.filter((e) => !seenEntryIds.has(e.id));

        if (newEntries.length > 0) {
          for (const e of newEntries) seenEntryIds.add(e.id);
          if (foundAtLen < 0) foundAtLen = len;
          results.push({
            matchedText: substr,
            entries: newEntries,
            deinflectReasons: candidate.reasons,
            matchStart: start,
          });
        }
      }
    }
  }

  return results;
}
