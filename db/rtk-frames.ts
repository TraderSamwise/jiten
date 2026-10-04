import type * as SQLite from "expo-sqlite";

import type { KanjiPrimitive, StrokePath } from "@/db/types";
import type { AssemblePiece } from "@/lib/rtk-assemble";
import {
  nodesInUnit,
  splitUnitIntoNodes,
  type CourseFrame,
  type NodeRef,
  type UnitShape,
} from "@/lib/rtk-course";

/**
 * The course's reads from the dictionary. Every one filters on
 * `heisig_lesson IS NOT NULL`: 800 of the 3,000 keyworded frames are volume 3
 * and have no lesson, so they are not on the path.
 */

/** The 56 unit shapes, counted rather than materialised — the path needs no frames. */
export async function loadUnitShapes(dictDb: SQLite.SQLiteDatabase): Promise<UnitShape[]> {
  const rows = await dictDb.getAllAsync<{ unit: number; frames: number }>(
    `SELECT heisig_lesson AS unit, COUNT(*) AS frames
       FROM kanji_characters
      WHERE heisig_lesson IS NOT NULL
      GROUP BY heisig_lesson
      ORDER BY heisig_lesson`,
  );
  return rows.map(({ unit, frames }) => ({ unit, nodeCount: nodesInUnit(frames) }));
}

export async function loadUnitFrames(
  dictDb: SQLite.SQLiteDatabase,
  unit: number,
): Promise<CourseFrame[]> {
  const rows = await dictDb.getAllAsync<{
    literal: string;
    heisig_index: number;
    heisig_keyword: string | null;
    heisig_lesson: number;
  }>(
    `SELECT literal, heisig_index, heisig_keyword, heisig_lesson
       FROM kanji_characters
      WHERE heisig_lesson = ? AND heisig_index IS NOT NULL
      ORDER BY heisig_index`,
    [unit],
  );
  return rows.map((row) => ({
    literal: row.literal,
    index: row.heisig_index,
    keyword: row.heisig_keyword ?? "",
    lesson: row.heisig_lesson,
  }));
}

/**
 * Every component the decomposition can identify, as assemble-drill decoys.
 * 868 of them, 233 being RTK's invented primitives, whose substitute glyph
 * lives on `primitives` rather than on the edge — hence the join. A component
 * with a keyword but neither a glyph nor an id is unusable as a tile and is
 * left out; `canAssemble` refuses the frames that contain one.
 */
export async function loadDecoyPieces(strokesDb: SQLite.SQLiteDatabase): Promise<AssemblePiece[]> {
  const rows = await strokesDb.getAllAsync<{
    target: string;
    glyph: string | null;
    keyword: string | null;
    display_glyph: string | null;
  }>(
    // The modal keyword per component, not an arbitrary one: 木 is "tree" on 172
    // edges but also "wood", "2 trees" and "3 trees", and a bare column under
    // GROUP BY would pick whichever row SQLite happened to keep.
    `SELECT target, glyph, keyword, display_glyph FROM (
       SELECT COALESCE(kp.glyph, 'p' || kp.primitive_id) AS target,
              kp.glyph AS glyph,
              kp.keyword AS keyword,
              p.display_glyph AS display_glyph,
              COUNT(*) AS n
         FROM kanji_primitives kp
         LEFT JOIN primitives p ON p.id = kp.primitive_id
        WHERE kp.keyword IS NOT NULL
          AND (kp.glyph IS NOT NULL OR kp.primitive_id IS NOT NULL)
        GROUP BY target, kp.keyword
     )
      GROUP BY target
     HAVING n = MAX(n)
      ORDER BY target`,
  );
  return rows.map((row) => ({
    target: row.target,
    glyph: row.glyph,
    displayGlyph: row.display_glyph,
    keyword: row.keyword,
  }));
}

/**
 * Path frames that look like this one, most alike first — the distractors for a
 * choice drill. Restricted to path frames because a distractor needs a keyword
 * to show; `idx_ks_literal_rank` covers the lookup.
 *
 * The runner asks for all five frames at once now (`loadSimilarForFrames`).
 * This stays as the one-frame reference the batched version is tested against,
 * so a difference between them shows up as a failure rather than a surprise.
 */
export async function loadSimilarPathFrames(
  dictDb: SQLite.SQLiteDatabase,
  literal: string,
  limit = 20,
): Promise<CourseFrame[]> {
  const rows = await dictDb.getAllAsync<{
    literal: string;
    heisig_index: number;
    heisig_keyword: string | null;
    heisig_lesson: number;
  }>(
    `SELECT k.literal, k.heisig_index, k.heisig_keyword, k.heisig_lesson
       FROM kanji_similarity s
       JOIN kanji_characters k ON k.literal = s.similar
      WHERE s.literal = ?
        AND k.heisig_lesson IS NOT NULL
        AND k.heisig_index IS NOT NULL
      ORDER BY s.rank
      LIMIT ?`,
    [literal, limit],
  );
  return rows.map((row) => ({
    literal: row.literal,
    index: row.heisig_index,
    keyword: row.heisig_keyword ?? "",
    lesson: row.heisig_lesson,
  }));
}

/** The five frames of one node, in Heisig order. Empty when the node is past the unit. */
export async function loadNodeFrames(
  dictDb: SQLite.SQLiteDatabase,
  ref: NodeRef,
): Promise<CourseFrame[]> {
  const frames = await loadUnitFrames(dictDb, ref.unit);
  return splitUnitIntoNodes(frames)[ref.node] ?? [];
}

/**
 * Everything the runner needs about a node's five frames, in one query each
 * rather than one per frame.
 *
 * Opening a node used to cost about twenty separate reads — five
 * decompositions, five sets of strokes, five lookalike lists, five glyph
 * origins, and the unit twice — and every one of them is a round trip across
 * the bridge to native SQLite. The queries themselves were never the cost.
 */

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

/** The decomposition of each frame, keyed by literal. */
export async function loadPrimitivesForFrames(
  strokesDb: SQLite.SQLiteDatabase,
  literals: readonly string[],
): Promise<Map<string, KanjiPrimitive[]>> {
  const byLiteral = new Map<string, KanjiPrimitive[]>(literals.map((l) => [l, []]));
  if (literals.length === 0) return byLiteral;
  const rows = await strokesDb.getAllAsync<{
    literal: string;
    position: number;
    glyph: string | null;
    primitive_id: number | null;
    keyword: string | null;
    is_primitive: number;
    display_glyph: string | null;
  }>(
    `SELECT kp.literal, kp.position, kp.glyph, kp.primitive_id, kp.keyword, kp.is_primitive,
            p.display_glyph
       FROM kanji_primitives kp
       LEFT JOIN primitives p ON p.id = kp.primitive_id
      WHERE kp.literal IN (${placeholders(literals.length)})
      ORDER BY kp.literal, kp.position`,
    [...literals],
  );
  for (const row of rows) {
    byLiteral.get(row.literal)?.push({
      position: row.position,
      glyph: row.glyph,
      primitiveId: row.primitive_id,
      keyword: row.keyword,
      isPrimitive: row.is_primitive === 1,
      displayGlyph: row.display_glyph,
    });
  }
  return byLiteral;
}

/** Each frame's stroke paths, keyed by literal. */
export async function loadStrokesForFrames(
  strokesDb: SQLite.SQLiteDatabase,
  literals: readonly string[],
): Promise<Map<string, StrokePath[]>> {
  const byLiteral = new Map<string, StrokePath[]>(literals.map((l) => [l, []]));
  if (literals.length === 0) return byLiteral;
  const rows = await strokesDb.getAllAsync<{ literal: string; stroke_paths: string | null }>(
    `SELECT literal, stroke_paths FROM kanji_strokes
      WHERE literal IN (${placeholders(literals.length)})`,
    [...literals],
  );
  for (const row of rows) {
    if (!row.stroke_paths) continue;
    try {
      byLiteral.set(row.literal, JSON.parse(row.stroke_paths) as StrokePath[]);
    } catch {
      // A malformed blob costs this frame its stroke drill, not the node.
    }
  }
  return byLiteral;
}

/** Each frame's lookalikes, most alike first, keyed by literal. */
export async function loadSimilarForFrames(
  dictDb: SQLite.SQLiteDatabase,
  literals: readonly string[],
  perFrame = 20,
): Promise<Map<string, CourseFrame[]>> {
  const byLiteral = new Map<string, CourseFrame[]>(literals.map((l) => [l, []]));
  if (literals.length === 0) return byLiteral;
  const rows = await dictDb.getAllAsync<{
    source: string;
    literal: string;
    heisig_index: number;
    heisig_keyword: string | null;
    heisig_lesson: number;
  }>(
    `SELECT s.literal AS source, k.literal, k.heisig_index, k.heisig_keyword, k.heisig_lesson
       FROM kanji_similarity s
       JOIN kanji_characters k ON k.literal = s.similar
      WHERE s.literal IN (${placeholders(literals.length)})
        AND k.heisig_lesson IS NOT NULL
        AND k.heisig_index IS NOT NULL
      ORDER BY s.literal, s.rank`,
    [...literals],
  );
  for (const row of rows) {
    const list = byLiteral.get(row.source);
    // The per-frame cap is applied here rather than in SQL: one LIMIT over a
    // five-frame result would cut the last frames off entirely.
    if (!list || list.length >= perFrame) continue;
    list.push({
      literal: row.literal,
      index: row.heisig_index,
      keyword: row.heisig_keyword ?? "",
      lesson: row.heisig_lesson,
    });
  }
  return byLiteral;
}

/**
 * Wiktionary's glyph origin for each frame, keyed by literal — absent until the
 * dictionary carries the prose (dict base v25).
 */
export async function loadGlyphOrigins(
  dictDb: SQLite.SQLiteDatabase,
  literals: readonly string[],
): Promise<Map<string, string>> {
  const byLiteral = new Map<string, string>();
  if (literals.length === 0) return byLiteral;
  try {
    const rows = await dictDb.getAllAsync<{ literal: string; glyph_origin: string | null }>(
      `SELECT literal, glyph_origin FROM kanji_characters
        WHERE literal IN (${placeholders(literals.length)})`,
      [...literals],
    );
    for (const row of rows) {
      if (row.glyph_origin) byLiteral.set(row.literal, row.glyph_origin);
    }
  } catch {
    // The column arrives with dict v25. Naming it in a SELECT throws until
    // then, and this read shares a Promise.all with the drills' option pool —
    // one missing column would have cost the node its choice questions.
  }
  return byLiteral;
}
