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
      const searchResults = await searchDictionary(
        dictDb,
        candidate.word,
        5,
      );

      const newEntries = searchResults.japanese.filter(
        (e) => !seenEntryIds.has(e.id),
      );

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
