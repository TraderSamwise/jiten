/**
 * Kanji query layer.
 *
 * Provides query functions for the kanji index tables.
 * Sync versions use better-sqlite3 (build-time).
 * Async versions use expo-sqlite (runtime).
 */

import type * as SQLite from "expo-sqlite";
import type { KanjiCharacter, StrokePath, SimilarKanji } from "./types";

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
  };
}

/** Get a single kanji by its literal character. */
export function getKanji(db: QueryDB, literal: string): KanjiCharacter | null {
  const row = db.prepare("SELECT * FROM kanji_characters WHERE literal = ?").get(literal) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToKanjiCharacter(row) : null;
}

/** Get the most visually similar kanji. */
export function getSimilarKanji(db: QueryDB, literal: string, limit: number = 20): SimilarKanji[] {
  const rows = db
    .prepare(
      "SELECT similar, score, rank FROM kanji_similarity WHERE literal = ? ORDER BY rank LIMIT ?",
    )
    .all(literal, limit) as { similar: string; score: number; rank: number }[];
  return rows.map((r) => ({
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
  return rows.map((r) => ({
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
     WHERE readings_on LIKE ? OR readings_kun LIKE ?
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
