import { HAS_KANJI } from "./japanese-surface";
import { shouldHide } from "./tags";
import type { DictEntry } from "@/db/types";

/**
 * Four distinct headwords: every word needs three others to stand beside it.
 * Counted by headword rather than entry because the candidate pool dedups by
 * headword — two entries spelled the same can only ever fill one choice.
 */
export const MIN_FILL_BLANK_WORDS = 4;

/**
 * The form shown in the choices. Unlike the context game, a kana-only word is
 * perfectly playable here — this game tests which word fits, not how to read it.
 */
export function getFillBlankHeadword(entry: DictEntry): string | null {
  const kanji = entry.kanji.find((form) => !shouldHide(form.tags))?.text;
  if (kanji) return kanji;
  return entry.kana.find((form) => !shouldHide(form.tags))?.text ?? null;
}

/**
 * The words a round can actually be built from: one entry per headword. Entries
 * spelled the same collapse, because the candidate pool dedups by headword and
 * two rounds keyed to one headword would repeat the same question.
 */
export function toPlayableFillBlankEntries(entries: DictEntry[]): DictEntry[] {
  const seen = new Set<string>();
  const playable: DictEntry[] = [];
  for (const entry of entries) {
    const headword = getFillBlankHeadword(entry);
    if (!headword || seen.has(headword)) continue;
    seen.add(headword);
    playable.push(entry);
  }
  return playable;
}

/**
 * First part of speech the entry actually declares. Entries with no POS at all
 * are common in the dictionary, and treating two of them as "the same POS" would
 * score junk pairs as closely related.
 */
function primaryPartOfSpeech(entry: DictEntry): string | null {
  for (const sense of entry.senses) {
    const pos = sense.partOfSpeech?.[0];
    if (pos) return pos;
  }
  return null;
}

function kanjiOf(word: string): Set<string> {
  return new Set([...word].filter((ch) => HAS_KANJI.test(ch)));
}

/**
 * How temptingly similar `candidate` is to `target`. A distractor only teaches
 * something if it is a plausible answer — a random noun next to a verb is free
 * marks. Points are ordered so part of speech dominates: an option in the wrong
 * form is the one thing that gives the answer away regardless of meaning.
 */
function relatednessScore(
  target: DictEntry,
  targetHeadword: string,
  candidate: DictEntry,
  candidateHeadword: string,
): number {
  let score = 0;

  const targetPos = primaryPartOfSpeech(target);
  const candidatePos = primaryPartOfSpeech(candidate);
  if (targetPos !== null && targetPos === candidatePos) score += 3;

  if (target.jlptLevel !== null && target.jlptLevel === candidate.jlptLevel) score += 2;

  const targetKanji = kanjiOf(targetHeadword);
  if (targetKanji.size > 0 && [...kanjiOf(candidateHeadword)].some((ch) => targetKanji.has(ch))) {
    score += 2;
  }

  if (Math.abs([...targetHeadword].length - [...candidateHeadword].length) <= 1) score += 1;

  return score;
}

export interface SelectCandidatesOptions {
  limit?: number;
  /** Injected so tests are deterministic; jitter only ever breaks ties. */
  random?: () => number;
}

/**
 * Pick the words most worth offering alongside `target`. The target is excluded
 * by both id and headword, which is what keeps the answer out of its own
 * distractor pool — a homograph would otherwise cost the question a distractor.
 */
export function selectDistractorCandidates(
  target: DictEntry,
  pool: DictEntry[],
  { limit = 10, random = Math.random }: SelectCandidatesOptions = {},
): DictEntry[] {
  const targetHeadword = getFillBlankHeadword(target);
  if (!targetHeadword) return [];

  const seen = new Set<string>([targetHeadword]);
  const scored: { entry: DictEntry; rank: number }[] = [];

  for (const candidate of pool) {
    if (candidate.id === target.id) continue;
    const headword = getFillBlankHeadword(candidate);
    if (!headword || seen.has(headword)) continue;
    seen.add(headword);

    // Jitter is below one point, so it reorders equals without ever outranking
    // a better match — repeated rounds vary, scoring still decides.
    const score = relatednessScore(target, targetHeadword, candidate, headword);
    scored.push({ entry: candidate, rank: score + random() });
  }

  return scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((item) => item.entry);
}
