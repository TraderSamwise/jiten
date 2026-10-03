import type * as SQLite from "expo-sqlite";

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
 * Path frames that look like this one, most alike first — the distractors for a
 * choice drill. Restricted to path frames because a distractor needs a keyword
 * to show; `idx_ks_literal_rank` covers the lookup.
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
