import type { KanjiPrimitive } from "@/db/types";
import type { KanjiMnemonicRequest } from "./kanji-mnemonic-ai";
import type { CourseFrame } from "./rtk-course";

/**
 * What the generator is told about a frame. The server truncates and drops
 * blanks itself (`kanjiMnemonicRequestSchema`), but silent truncation there
 * would mean a primitive quietly missing from the story, so the caps are
 * honoured here where they can be seen.
 */

/** From `kanjiMnemonicRequestSchema` in lib/api-contract.ts. */
export const MAX_KEYWORD_CHARS = 120;
export const MAX_PRIMITIVES = 12;
export const MAX_MY_WORDS = 12;
export const MAX_MY_WORD_CHARS = 60;
export const MAX_EXAMPLES = 3;
export const MAX_EXAMPLE_CHARS = 400;

/** Trimmed, de-duplicated and capped the way the server would cap them. */
function capped(
  values: readonly string[] | undefined,
  maxItems: number,
  maxChars: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const kept = value.trim().slice(0, maxChars);
    if (!kept || seen.has(kept)) continue;
    seen.add(kept);
    out.push(kept);
    if (out.length === maxItems) break;
  }
  return out;
}

/** The primitive keywords the story should weave, in writing order. */
export function primitiveKeywords(primitives: readonly KanjiPrimitive[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const primitive of [...primitives].sort((a, b) => a.position - b.position)) {
    const keyword = primitive.keyword?.trim().slice(0, MAX_KEYWORD_CHARS) ?? "";
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
    if (keywords.length === MAX_PRIMITIVES) break;
  }
  return keywords;
}

/**
 * A frame's generation request, or null when there is nothing to ask for — a
 * keyword is required, and the course has no frame without one.
 */
export function mnemonicRequestFor(
  frame: CourseFrame,
  primitives: readonly KanjiPrimitive[],
  userKeyword?: string | null,
  archive?: { myWords?: readonly string[]; examples?: readonly string[] },
): KanjiMnemonicRequest | null {
  const keyword = (userKeyword?.trim() || frame.keyword.trim()).slice(0, MAX_KEYWORD_CHARS);
  if (!keyword) return null;
  return {
    kanji: frame.literal,
    keyword,
    primitives: primitiveKeywords(primitives),
    myWords: capped(archive?.myWords, MAX_MY_WORDS, MAX_MY_WORD_CHARS),
    examples: capped(archive?.examples, MAX_EXAMPLES, MAX_EXAMPLE_CHARS),
  };
}
