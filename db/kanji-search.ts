/**
 * Kanji query layer.
 *
 * Provides query functions for the kanji index tables.
 * Sync versions use better-sqlite3 (build-time).
 * Async versions use expo-sqlite (runtime).
 */

import type * as SQLite from "expo-sqlite";
import type { KanjiCharacter, StrokePath, SimilarKanji, KanjiPrimitive, Primitive } from "./types";

/** Generic DB interface that works with both better-sqlite3 and expo-sqlite. */
interface QueryDB {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown | undefined;
  };
}

function parseJsonArray<T>(val: string | null): T[] {
  if (!val) return [];
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

function rowToKanjiCharacter(row: Record<string, unknown>): KanjiCharacter {
  return {
    literal: row.literal as string,
    grade: row.grade as number | null,
    strokeCount: row.stroke_count as number,
    frequencyRank: row.frequency_rank as number | null,
    jlptOld: row.jlpt_old as number | null,
    jlptLevel: row.jlpt_level as number | null,
    readingsOn: parseJsonArray<string>(row.readings_on as string | null),
    readingsKun: parseJsonArray<string>(row.readings_kun as string | null),
    meanings: parseJsonArray<string>(row.meanings as string | null),
    nanori: parseJsonArray<string>(row.nanori as string | null),
    radicalClassical: row.radical_classical as number | null,
    radicalNelson: row.radical_nelson as number | null,
    heisigIndex: row.heisig_index as number | null,
    unicodeCodepoint: row.unicode_codepoint as string,
    strokePaths: parseJsonArray<StrokePath>(row.stroke_paths as string | null),
    heisigKeyword: (row.heisig_keyword as string | null) ?? null,
    heisigLesson: (row.heisig_lesson as number | null) ?? null,
  };
}

/** Get a single kanji by its literal character. */
export function getKanji(db: QueryDB, literal: string): KanjiCharacter | null {
  const row = db.prepare("SELECT * FROM kanji_characters WHERE literal = ?").get(literal) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToKanjiCharacter(row) : null;
}

/** Check if a character is a CJK Unified Ideograph (kanji). */
function isCJK(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

/** Get the most visually similar kanji. */
export function getSimilarKanji(db: QueryDB, literal: string, limit: number = 20): SimilarKanji[] {
  const rows = db
    .prepare(
      "SELECT similar, score, rank FROM kanji_similarity WHERE literal = ? ORDER BY rank LIMIT ?",
    )
    .all(literal, limit) as { similar: string; score: number; rank: number }[];
  return rows
    .filter((r) => isCJK(r.similar))
    .map((r) => ({
      literal: r.similar,
      score: r.score,
      rank: r.rank,
    }));
}

/** Search for kanji that contain ALL specified radicals. */
export function searchByRadicals(db: QueryDB, radicals: string[]): KanjiCharacter[] {
  if (radicals.length === 0) return [];

  // Find kanji that have ALL specified radicals
  const placeholders = radicals.map(() => "?").join(", ");
  const sql = `
    SELECT kc.* FROM kanji_characters kc
    WHERE kc.literal IN (
      SELECT literal FROM kanji_radicals
      WHERE radical IN (${placeholders})
      GROUP BY literal
      HAVING COUNT(DISTINCT radical) = ?
    )
    ORDER BY kc.frequency_rank IS NULL, kc.frequency_rank
    LIMIT 100
  `;
  const rows = db.prepare(sql).all(...radicals, radicals.length) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

/** Full-text search kanji by English meaning. */
export function searchKanjiByMeaning(db: QueryDB, query: string): KanjiCharacter[] {
  const rows = db
    .prepare(
      `SELECT kc.* FROM kanji_meanings_fts fts
       JOIN kanji_characters kc ON kc.literal = fts.literal
       WHERE fts.meanings MATCH ?
       ORDER BY kc.frequency_rank IS NULL, kc.frequency_rank
       LIMIT 50`,
    )
    .all(query) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

/** Get kanji with similar English meanings. */
export function getSimilarByMeaning(
  db: QueryDB,
  literal: string,
  limit: number = 10,
): KanjiCharacter[] {
  const kanji = getKanji(db, literal);
  if (!kanji || kanji.meanings.length === 0) return [];

  const ftsQuery = kanji.meanings.join(" OR ");
  const rows = db
    .prepare(
      `SELECT DISTINCT kc.* FROM kanji_meanings_fts fts
       JOIN kanji_characters kc ON kc.literal = fts.literal
       WHERE fts.meanings MATCH ? AND kc.literal != ?
       ORDER BY kc.frequency_rank IS NULL, kc.frequency_rank
       LIMIT ${limit}`,
    )
    .all(ftsQuery, literal) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

/** Get all kanji for a given jouyou grade. */
export function getKanjiByGrade(db: QueryDB, grade: number): KanjiCharacter[] {
  const rows = db
    .prepare(
      "SELECT * FROM kanji_characters WHERE grade = ? ORDER BY frequency_rank IS NULL, frequency_rank",
    )
    .all(grade) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

/** Get all kanji for a given JLPT level. */
export function getKanjiByJlpt(db: QueryDB, level: number): KanjiCharacter[] {
  const rows = db
    .prepare(
      "SELECT * FROM kanji_characters WHERE jlpt_level = ? ORDER BY frequency_rank IS NULL, frequency_rank",
    )
    .all(level) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

/** Get all unique radicals used in the KRADFILE decomposition. */
export function getAllRadicals(db: QueryDB): string[] {
  const rows = db.prepare("SELECT DISTINCT radical FROM kanji_radicals ORDER BY radical").all() as {
    radical: string;
  }[];
  return rows.map((r) => r.radical);
}

/** Search kanji by on'yomi or kun'yomi reading. */
export function searchKanjiByReading(db: QueryDB, reading: string): KanjiCharacter[] {
  // Search in both on and kun readings JSON arrays
  const pattern = `%"${reading}"%`;
  const rows = db
    .prepare(
      `SELECT * FROM kanji_characters
       WHERE readings_on LIKE ? OR readings_kun LIKE ?
       ORDER BY frequency_rank IS NULL, frequency_rank
       LIMIT 50`,
    )
    .all(pattern, pattern) as Record<string, unknown>[];
  return rows.map(rowToKanjiCharacter);
}

// ─── Async runtime wrappers (expo-sqlite) ───

/** Get a single kanji by its literal character (async). */
export async function getKanjiAsync(
  db: SQLite.SQLiteDatabase,
  literal: string,
): Promise<KanjiCharacter | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM kanji_characters WHERE literal = ?",
    [literal],
  );
  return row ? rowToKanjiCharacter(row) : null;
}

/** Get the most visually similar kanji (async). */
export async function getSimilarKanjiAsync(
  db: SQLite.SQLiteDatabase,
  literal: string,
  limit: number = 20,
): Promise<SimilarKanji[]> {
  const rows = await db.getAllAsync<{ similar: string; score: number; rank: number }>(
    "SELECT similar, score, rank FROM kanji_similarity WHERE literal = ? ORDER BY rank LIMIT ?",
    [literal, limit],
  );
  return rows
    .filter((r) => isCJK(r.similar))
    .map((r) => ({
      literal: r.similar,
      score: r.score,
      rank: r.rank,
    }));
}

/** Search for kanji that contain ALL specified radicals (async). */
export async function searchByRadicalsAsync(
  db: SQLite.SQLiteDatabase,
  radicals: string[],
): Promise<KanjiCharacter[]> {
  if (radicals.length === 0) return [];

  const placeholders = radicals.map(() => "?").join(", ");
  const sql = `
    SELECT kc.* FROM kanji_characters kc
    WHERE kc.literal IN (
      SELECT literal FROM kanji_radicals
      WHERE radical IN (${placeholders})
      GROUP BY literal
      HAVING COUNT(DISTINCT radical) = ?
    )
    ORDER BY kc.frequency_rank IS NULL, kc.frequency_rank
    LIMIT 100
  `;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, [...radicals, radicals.length]);
  return rows.map(rowToKanjiCharacter);
}

/** Full-text search kanji by English meaning (async). */
export async function searchKanjiByMeaningAsync(
  db: SQLite.SQLiteDatabase,
  query: string,
): Promise<KanjiCharacter[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT kc.* FROM kanji_meanings_fts fts
     JOIN kanji_characters kc ON kc.literal = fts.literal
     WHERE fts.meanings MATCH ?
     AND (kc.grade IS NOT NULL OR kc.jlpt_level IS NOT NULL OR kc.frequency_rank IS NOT NULL OR kc.heisig_index IS NOT NULL)
     ORDER BY kc.frequency_rank IS NULL, kc.frequency_rank
     LIMIT 50`,
    [query],
  );
  return rows.map(rowToKanjiCharacter);
}

/** Search kanji by on'yomi or kun'yomi reading (async). */
export async function searchKanjiByReadingAsync(
  db: SQLite.SQLiteDatabase,
  reading: string,
): Promise<KanjiCharacter[]> {
  const pattern = `%"${reading}"%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM kanji_characters
     WHERE (readings_on LIKE ? OR readings_kun LIKE ?)
     AND (grade IS NOT NULL OR jlpt_level IS NOT NULL OR frequency_rank IS NOT NULL OR heisig_index IS NOT NULL)
     ORDER BY frequency_rank IS NULL, frequency_rank
     LIMIT 50`,
    [pattern, pattern],
  );
  return rows.map(rowToKanjiCharacter);
}

/** Get all unique radicals (async). */
export async function getAllRadicalsAsync(db: SQLite.SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ radical: string }>(
    "SELECT DISTINCT radical FROM kanji_radicals ORDER BY radical",
  );
  return rows.map((r) => r.radical);
}

/** Get kanji with similar English meanings (async). */
export async function getSimilarByMeaningAsync(
  db: SQLite.SQLiteDatabase,
  literal: string,
  limit: number = 10,
): Promise<KanjiCharacter[]> {
  const kanji = await getKanjiAsync(db, literal);
  if (!kanji || kanji.meanings.length === 0) return [];

  // Use LIKE on the JSON meanings column instead of FTS5 —
  // expo-sqlite's web worker hangs on FTS MATCH queries.
  const likeClauses = kanji.meanings.map(() => `meanings LIKE ?`).join(" OR ");
  const likeParams = kanji.meanings.map((m) => `%"${m}"%`);

  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM kanji_characters
     WHERE (${likeClauses}) AND literal != ?
     ORDER BY frequency_rank IS NULL, frequency_rank
     LIMIT ${limit}`,
    [...likeParams, literal],
  );
  return rows.map(rowToKanjiCharacter);
}

/** Get stroke paths from the separate strokes DB (async). */
export async function getStrokePathsAsync(
  strokesDb: SQLite.SQLiteDatabase,
  literal: string,
): Promise<StrokePath[]> {
  const row = await strokesDb.getFirstAsync<{ stroke_paths: string }>(
    "SELECT stroke_paths FROM kanji_strokes WHERE literal = ?",
    [literal],
  );
  return row ? parseJsonArray<StrokePath>(row.stroke_paths) : [];
}

/** Get the RTK primitive decomposition for a kanji from the strokes DB (async). */
export async function getPrimitivesForKanjiAsync(
  strokesDb: SQLite.SQLiteDatabase,
  literal: string,
): Promise<KanjiPrimitive[]> {
  const rows = await strokesDb.getAllAsync<{
    position: number;
    glyph: string | null;
    primitive_id: number | null;
    keyword: string | null;
    is_primitive: number;
  }>(
    "SELECT position, glyph, primitive_id, keyword, is_primitive FROM kanji_primitives WHERE literal = ? ORDER BY position",
    [literal],
  );
  return rows.map((r) => ({
    position: r.position,
    glyph: r.glyph,
    primitiveId: r.primitive_id,
    keyword: r.keyword,
    isPrimitive: r.is_primitive === 1,
  }));
}

/** Get a single primitive by id from the strokes DB (async). */
export async function getPrimitiveAsync(
  strokesDb: SQLite.SQLiteDatabase,
  id: number,
): Promise<Primitive | null> {
  const row = await strokesDb.getFirstAsync<{
    id: number;
    keyword: string | null;
    display_glyph: string | null;
    real_glyph: string | null;
    strokes: number | null;
  }>("SELECT id, keyword, display_glyph, real_glyph, strokes FROM primitives WHERE id = ?", [id]);
  return row
    ? {
        id: row.id,
        keyword: row.keyword,
        displayGlyph: row.display_glyph,
        realGlyph: row.real_glyph,
        strokes: row.strokes,
      }
    : null;
}

/** Get literals of kanji that use a given invented primitive as a component (async). */
export async function getKanjiUsingPrimitiveAsync(
  strokesDb: SQLite.SQLiteDatabase,
  primitiveId: number,
  limit: number = 100,
): Promise<string[]> {
  const rows = await strokesDb.getAllAsync<{ literal: string }>(
    "SELECT DISTINCT literal FROM kanji_primitives WHERE primitive_id = ? ORDER BY literal LIMIT ?",
    [primitiveId, limit],
  );
  return rows.map((r) => r.literal);
}

/**
 * Get the synonym set for an RTK keyword from the strokes tier (async).
 * Bidirectional: matches rows where the keyword is either side of a pair, so
 * "house"→"home" and "home"→"house" both resolve. Returns lowercased words.
 */
export async function getSynonymsForKeywordAsync(
  strokesDb: SQLite.SQLiteDatabase,
  keyword: string,
): Promise<string[]> {
  const kw = keyword.toLowerCase();
  const rows = await strokesDb.getAllAsync<{ word: string }>(
    `SELECT synonym AS word FROM keyword_synonyms WHERE keyword = ?
     UNION
     SELECT keyword AS word FROM keyword_synonyms WHERE synonym = ?`,
    [kw, kw],
  );
  return rows.map((r) => r.word).filter((w) => w !== kw);
}

/** Batch-fetch kanji by their literal characters (async). */
export async function getKanjiBatchAsync(
  db: SQLite.SQLiteDatabase,
  literals: string[],
): Promise<KanjiCharacter[]> {
  if (literals.length === 0) return [];
  const placeholders = literals.map(() => "?").join(", ");
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM kanji_characters WHERE literal IN (${placeholders})`,
    literals,
  );
  return rows.map(rowToKanjiCharacter);
}

/** Get radicals for a specific kanji (async). */
export async function getRadicalsForKanjiAsync(
  db: SQLite.SQLiteDatabase,
  literal: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ radical: string }>(
    "SELECT radical FROM kanji_radicals WHERE literal = ? ORDER BY radical",
    [literal],
  );
  return rows.map((r) => r.radical);
}

/** Get kanji that use a given character as a radical/component (async). */
export async function getKanjiUsingRadicalAsync(
  db: SQLite.SQLiteDatabase,
  radical: string,
  limit: number = 30,
): Promise<KanjiCharacter[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT kc.* FROM kanji_characters kc
     JOIN kanji_radicals kr ON kc.literal = kr.literal
     WHERE kr.radical = ?
     ORDER BY kc.heisig_index IS NULL, kc.heisig_index, kc.frequency_rank IS NULL, kc.frequency_rank
     LIMIT ?`,
    [radical, limit],
  );
  return rows.map(rowToKanjiCharacter);
}

/** Get kanji literals for a JLPT level (null = non-jouyou). */
export async function getKanjiLiteralsByJlptAsync(
  db: SQLite.SQLiteDatabase,
  level: number | null,
): Promise<string[]> {
  const sql =
    level === null
      ? "SELECT literal FROM kanji_characters WHERE jlpt_level IS NULL"
      : "SELECT literal FROM kanji_characters WHERE jlpt_level = ?";
  const rows = await db.getAllAsync<{ literal: string }>(sql, level === null ? [] : [level]);
  return rows.map((r) => r.literal);
}

/** Get kanji by RTK lesson number (async). */
export async function getKanjiByLessonAsync(
  db: SQLite.SQLiteDatabase,
  lesson: number,
): Promise<KanjiCharacter[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM kanji_characters WHERE heisig_lesson = ? ORDER BY heisig_index",
    [lesson],
  );
  return rows.map(rowToKanjiCharacter);
}
