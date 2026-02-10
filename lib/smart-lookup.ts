import * as SQLite from "expo-sqlite";
import { searchDictionary } from "@/db/search";
import type { DictEntry } from "@/db/types";
import { deinflect, generateSubstrings } from "./deinflect";

export interface LookupResult {
  matchedText: string;
  entries: DictEntry[];
  deinflectReasons: string[];
}

/**
 * Lookup for user-selected text: walks through the entire selection,
 * finding each word and advancing past it. Calls onResult as each
 * word is found so the UI can update progressively.
 */
export async function selectionLookup(
  text: string,
  dictDb: SQLite.SQLiteDatabase,
  onResult: (result: LookupResult) => void,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Try the full selected text as a single lookup first
  const fullResults = await searchDictionary(dictDb, trimmed, 10);
  if (fullResults.japanese.length > 0) {
    onResult({
      matchedText: trimmed,
      entries: fullResults.japanese,
      deinflectReasons: [],
    });
    return;
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
      const searchResults = await searchDictionary(dictDb, candidate.word, 5);
      const newEntries = searchResults.japanese.filter((e) => !seenEntryIds.has(e.id));

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
      const searchResults = await searchDictionary(dictDb, candidate.word, 5);

      const newEntries = searchResults.japanese.filter((e) => !seenEntryIds.has(e.id));

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
