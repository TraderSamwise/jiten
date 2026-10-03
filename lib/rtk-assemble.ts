import type { KanjiPrimitive } from "@/db/types";

/**
 * The assemble drill: tap a kanji's components in writing order. This is RTK's
 * own thesis as an exercise — the frame IS its parts in that order — and the
 * decomposition tables already know the answer.
 */

/** Below two components there is nothing to assemble. */
export const MIN_COMPONENTS = 2;

export interface AssemblePiece {
  /** `p<id>` for an invented primitive, the glyph for a real one. */
  target: string;
  glyph: string | null;
  displayGlyph: string | null;
  keyword: string | null;
}

/** The identity `db/primitive-associations.ts` uses, so the two agree. */
export function pieceOf(primitive: KanjiPrimitive): AssemblePiece | null {
  const target =
    primitive.glyph ?? (primitive.primitiveId != null ? `p${primitive.primitiveId}` : null);
  if (!target) return null;
  return {
    target,
    glyph: primitive.glyph,
    displayGlyph: primitive.displayGlyph,
    keyword: primitive.keyword,
  };
}

/** The answer: the frame's components, in writing order, each identifiable. */
export function answerPieces(primitives: readonly KanjiPrimitive[]): AssemblePiece[] {
  const seen = new Set<string>();
  const pieces: AssemblePiece[] = [];
  for (const primitive of [...primitives].sort((a, b) => a.position - b.position)) {
    const piece = pieceOf(primitive);
    // A component repeated in one kanji (林 = tree + tree) is asked once: two
    // identical tiles would be indistinguishable to tap.
    if (!piece || seen.has(piece.target)) continue;
    seen.add(piece.target);
    pieces.push(piece);
  }
  return pieces;
}

function random(seed: number): () => number {
  let state = (seed | 0) ^ 0x9e3779b9;
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

export interface AssembleBoard {
  /** The pieces to tap, in the order they must be tapped. */
  answer: AssemblePiece[];
  /** Every tile on screen, answer and decoys together, in display order. */
  tiles: AssemblePiece[];
}

/**
 * The tiles for one frame: its components plus a few decoys from the wider
 * pool, so the drill is not "tap all of them in some order".
 */
export function buildBoard(
  primitives: readonly KanjiPrimitive[],
  pool: readonly AssemblePiece[],
  decoyCount: number,
  seed: number,
): AssembleBoard {
  const answer = answerPieces(primitives);
  const taken = new Set(answer.map((piece) => piece.target));
  const decoys: AssemblePiece[] = [];
  for (const piece of shuffled(pool, seed)) {
    if (decoys.length >= decoyCount) break;
    if (!piece.keyword || taken.has(piece.target)) continue;
    taken.add(piece.target);
    decoys.push(piece);
  }
  return { answer, tiles: shuffled([...answer, ...decoys], seed + 1) };
}

export type AssembleVerdict = "building" | "wrong" | "done";

/** How a tap sequence stands against the answer. */
export function judge(
  picked: readonly string[],
  answer: readonly AssemblePiece[],
): AssembleVerdict {
  for (let i = 0; i < picked.length; i++) {
    if (picked[i] !== answer[i]?.target) return "wrong";
  }
  return picked.length === answer.length ? "done" : "building";
}
