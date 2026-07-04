import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { getPrimitivesForKanjiAsync, getSynonymsForKeywordAsync } from "./kanji-search";
import {
  getAssociationsForWordsAsync,
  canonicalStem,
  targetForPrimitive,
} from "./primitive-associations";

/**
 * Semantic candidate resolver for the mnemonic auto-linker.
 *
 * Given a kanji and words from the user's story, returns which of the kanji's
 * primitive targets each word likely refers to, ranked by confidence. Combines
 * three signals, none of which needs the 117MB extended tier:
 *   1. keyword    — the word stems to a primitive's own keyword (strongest)
 *   2. synonym    — the word is a WordNet synonym of a primitive keyword (strokes tier)
 *   3. personal   — the user has historically used the word for this primitive
 *                   across their own mnemonic archive (learned vocabulary)
 *
 * The editor consumes the confidence to decide auto-apply vs. suggest.
 */

export interface ResolvedCandidate {
  target: string; // "p<id>" for invented primitives, glyph for real-kanji components
  keyword: string | null;
  confidence: number; // 0..1
  source: "keyword" | "synonym" | "personal";
}

export const AUTO_LINK_THRESHOLD = 0.5;

const KEYWORD_SCORE = 1.0;
const SYNONYM_SCORE = 0.7;

/** Personal-association confidence: grows with distinct-story count, capped below an exact synonym. */
function personalScore(count: number): number {
  if (count <= 0) return 0;
  return Math.min(0.5 + 0.13 * count, 0.85);
}

interface Component {
  target: string;
  keyword: string | null;
  keywordStem: string | null;
  synonymStems: Set<string>;
}

export async function resolveKanjiWordCandidates(
  strokesDb: SQLite.SQLiteDatabase | null,
  userDb: WrappedUserDb | null,
  literal: string,
  words: string[],
  opts?: { threshold?: number; excludeCurrentNote?: boolean },
): Promise<Map<string, ResolvedCandidate[]>> {
  const result = new Map<string, ResolvedCandidate[]>();
  if (!strokesDb || words.length === 0) return result;

  const primitives = await getPrimitivesForKanjiAsync(strokesDb, literal);
  const comps = (
    await Promise.all(
      primitives.map(async (p): Promise<Component | null> => {
        const target = targetForPrimitive(p);
        if (!target) return null;
        const synonymStems = new Set<string>();
        if (p.keyword) {
          for (const syn of await getSynonymsForKeywordAsync(strokesDb, p.keyword)) {
            synonymStems.add(canonicalStem(syn));
          }
        }
        return {
          target,
          keyword: p.keyword,
          keywordStem: p.keyword ? canonicalStem(p.keyword) : null,
          synonymStems,
        };
      }),
    )
  ).filter((c): c is Component => c !== null);
  if (comps.length === 0) return result;

  const threshold = opts?.threshold ?? AUTO_LINK_THRESHOLD;
  const personal = userDb
    ? await getAssociationsForWordsAsync(
        userDb,
        words,
        opts?.excludeCurrentNote ? literal : undefined,
      )
    : new Map<string, Map<string, number>>();

  for (const word of words) {
    const stem = canonicalStem(word);
    const personalForWord = personal.get(stem);
    const candidates: ResolvedCandidate[] = [];
    for (const c of comps) {
      let score = 0;
      let source: ResolvedCandidate["source"] = "keyword";
      if (c.keywordStem && stem === c.keywordStem) {
        score = KEYWORD_SCORE;
        source = "keyword";
      } else if (c.synonymStems.has(stem)) {
        score = SYNONYM_SCORE;
        source = "synonym";
      }
      const pScore = personalForWord ? personalScore(personalForWord.get(c.target) ?? 0) : 0;
      if (pScore > score) {
        score = pScore;
        source = "personal";
      }
      if (score > 0 && score >= threshold) {
        candidates.push({ target: c.target, keyword: c.keyword, confidence: score, source });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.confidence - a.confidence);
      result.set(word, candidates);
    }
  }
  return result;
}
