import type { ArenaPrimitive } from "../protocol";
import { CORPUS } from "./corpus";

// The Forge: reading a spirit means naming each of its primitives (shape → its
// keyword) before committing the whole on the verb wheel. These are the pure
// pieces — decoy generation and shape/font resolution; the gameplay wiring lives
// in DungeonScene and the rendering in HudScene.

export interface Choice {
  keyword: string;
  correct: boolean;
}

// Structural RNG so this module (and its test) never needs a value import of
// Phaser — DungeonScene's Phaser.Math.RandomDataGenerator satisfies it, and the
// test passes a deterministic stub.
export interface ShuffleRng {
  shuffle<T>(array: T[]): T[];
}

// Padding for decoy keywords when the loaded corpus is too small to supply
// enough distinct wrong answers (e.g. early runs, the standalone stub build).
export const FALLBACK_KEYWORDS: string[] = [
  "sun",
  "moon",
  "tree",
  "mouth",
  "person",
  "water",
  "fire",
  "woman",
  "child",
  "king",
  "field",
  "eye",
  "hand",
  "heart",
  "gate",
  "stone",
  "soil",
  "rice",
  "mountain",
  "river",
  "day",
  "roof",
  "thread",
  "power",
  "sword",
  "shell",
  "wind",
  "rain",
  "road",
  "bird",
];

// Every distinct primitive keyword the loaded corpus knows about — the natural
// decoy pool, since these are names the player has actually met. CORPUS is
// mutated in place at load, so this reads live each call.
export function forgePool(): string[] {
  const seen = new Set<string>();
  for (const e of CORPUS) {
    for (const p of e.primitives) {
      if (p.keyword) seen.add(p.keyword);
    }
  }
  return [...seen];
}

// The correct keyword plus (count-1) decoys, shuffled, with exactly one marked
// correct. Decoys come from the corpus pool first, padded from FALLBACK; the
// result may be shorter than count only if even the fallback runs dry.
export function buildPrimitiveChoices(correct: string, count: number, rng: ShuffleRng): Choice[] {
  const wantDecoys = Math.max(0, count - 1);
  const pool = forgePool().filter((k) => k !== correct);
  const decoys = rng.shuffle(pool.slice()).slice(0, wantDecoys);
  if (decoys.length < wantDecoys) {
    const taken = new Set([correct, ...decoys]);
    const pad = FALLBACK_KEYWORDS.filter((k) => !taken.has(k));
    decoys.push(...rng.shuffle(pad).slice(0, wantDecoys - decoys.length));
  }
  const choices: Choice[] = [
    { keyword: correct, correct: true },
    ...decoys.map((keyword) => ({ keyword, correct: false })),
  ];
  return rng.shuffle(choices);
}

export function hasShape(p: ArenaPrimitive): boolean {
  return !!(p.glyph || p.display);
}

// The glyph to draw for a primitive and whether it needs the bundled RTK font
// (invented shapes) rather than the CJK font (real kanji glyphs).
export function primitiveFace(p: ArenaPrimitive): { text: string; rtk: boolean } {
  if (p.glyph) return { text: p.glyph, rtk: false };
  if (p.display) return { text: p.display, rtk: true };
  return { text: p.keyword, rtk: false };
}
