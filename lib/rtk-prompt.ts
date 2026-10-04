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
): KanjiMnemonicRequest | null {
  const keyword = (userKeyword?.trim() || frame.keyword.trim()).slice(0, MAX_KEYWORD_CHARS);
  if (!keyword) return null;
  // An empty list is allowed: the server grounds a story in the glyph origin
  // and the crowd's best hook as well as the primitives, so a frame whose
  // decomposition has not arrived still gets a story worth reading. Refusing
  // here is what made Generate dead on a device without the strokes tier.
  return { kanji: frame.literal, keyword, primitives: primitiveKeywords(primitives) };
}
