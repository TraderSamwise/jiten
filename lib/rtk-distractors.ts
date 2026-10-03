import type { CourseFrame } from "./rtk-course";

/**
 * The wrong answers for a choice drill. Visual confusion is the real failure
 * mode in RTK — 日 against 目, 待 against 侍 — so the lookalikes come first and
 * the unit only tops up: 7 of the 2,200 frames have no lookalike that is itself
 * a frame, and 43 have fewer than three.
 */

/** A deterministic 32-bit PRNG, so a test can pin an arrangement. */
function random(seed: number): () => number {
  let state = (seed | 0) ^ 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface DistractorInput {
  answer: CourseFrame;
  /** Path frames that look like the answer, most alike first. */
  similar: readonly CourseFrame[];
  /** The answer's own unit, for topping up. */
  unit: readonly CourseFrame[];
  /** How many wrong answers are wanted. */
  count: number;
}

/**
 * Lookalikes first, then the nearest frames of the same unit — near in frame
 * number, so a distractor was met around the same time as the answer. Returns
 * fewer than asked rather than padding with something arbitrary.
 */
export function pickDistractors({ answer, similar, unit, count }: DistractorInput): CourseFrame[] {
  if (count <= 0) return [];
  const taken = new Set<string>([answer.literal]);
  const picked: CourseFrame[] = [];

  const take = (frame: CourseFrame) => {
    if (picked.length >= count || taken.has(frame.literal) || !frame.keyword) return;
    taken.add(frame.literal);
    picked.push(frame);
  };

  for (const frame of similar) take(frame);

  if (picked.length < count) {
    const nearest = [...unit].sort(
      (a, b) => Math.abs(a.index - answer.index) - Math.abs(b.index - answer.index),
    );
    for (const frame of nearest) take(frame);
  }

  return picked;
}

export interface Choice {
  frame: CourseFrame;
  correct: boolean;
}

/**
 * The drill's options, in the order they are shown. The answer's position comes
 * from the seed — a fixed position would be learnable in a session or two.
 */
export function buildChoices(input: DistractorInput, seed: number): Choice[] {
  const distractors = pickDistractors(input);
  const options: Choice[] = [
    { frame: input.answer, correct: true },
    ...distractors.map((frame) => ({ frame, correct: false })),
  ];
  return shuffled(options, seed);
}
