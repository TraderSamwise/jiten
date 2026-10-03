import { canonicalStem } from "@/db/primitive-associations";
import { parseMnemonicMarkup, serializeMnemonicMarkup } from "./mnemonic-markup";

/**
 * The learner's own story with its keyword taken out. The markup already has a
 * token for the keyword — `{self}` — so the blank is a rendering choice rather
 * than surgery on their prose.
 */

export const BLANK = "_____";

/** Whether this story can be clozed at all: something has to be hidden. */
export function canCloze(story: string | null | undefined, keyword: string): boolean {
  if (!story?.trim() || !keyword.trim()) return false;
  return clozed(story, keyword) !== story;
}

/**
 * The story with the keyword blanked. `{self}` first, since that is the
 * markup's own name for it; failing that, the keyword where it was written out.
 */
export function clozed(story: string, keyword: string): string {
  const nodes = parseMnemonicMarkup(story);
  if (nodes.some((node) => node.type === "self")) {
    return serializeMnemonicMarkup(
      nodes.map((node) => (node.type === "self" ? { type: "text" as const, value: BLANK } : node)),
    );
  }

  const written = keyword.trim();
  if (!written) return story;
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole words only, so "art" does not punch a hole in "start" — but a
  // boundary only means anything next to a word character, and a keyword can
  // begin or end with punctuation.
  const open = /^\w/.test(written) ? "\\b" : "";
  const close = /\w$/.test(written) ? "\\b" : "";
  return story.replace(new RegExp(`${open}${escaped}${close}`, "gi"), BLANK);
}

/**
 * Whether what the learner typed is the keyword. Deliberately generous: the
 * exercise is recalling the frame, not spelling it — `keyword_synonyms` carries
 * 81,036 pairs and a stem match forgives a plural or a tense.
 */
export function accepts(typed: string, keyword: string, synonyms: readonly string[] = []): boolean {
  const said = typed.trim().toLowerCase();
  if (!said) return false;
  if (said === keyword.trim().toLowerCase()) return true;

  const stem = canonicalStem(said);
  if (!stem) return false;
  if (stem === canonicalStem(keyword)) return true;
  return synonyms.some((synonym) => canonicalStem(synonym) === stem);
}

export interface ClozeAsk {
  /** The list's input mode is cloze. */
  enabled: boolean;
  /** The card has not been answered yet; a revealed card shows its own back. */
  pending: boolean;
  /** Word cards have no mnemonic of their own to blank. */
  isKanji: boolean;
  /** The learner's story, or null while it is unread or absent. */
  story: string | null;
  /** Their keyword, else Heisig's; null when neither is known yet. */
  keyword: string | null;
}

/**
 * Whether this card should be asked as a cloze. Separate from the screen that
 * renders it because every one of these conditions can silently switch the
 * exercise off, and the course shipped once with a cloze that never fired.
 */
export function shouldAskAsCloze({ enabled, pending, isKanji, story, keyword }: ClozeAsk): boolean {
  if (!enabled || !pending || !isKanji || !keyword) return false;
  return canCloze(story, keyword);
}
