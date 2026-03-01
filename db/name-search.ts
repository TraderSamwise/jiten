import type { SQLiteDatabase } from "expo-sqlite";
import { toHiragana } from "wanakana";
import type { NameEntry } from "./types";

export type NameFilter = "all" | "person" | "place";

function hasJapanese(input: string): boolean {
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x3040 && c <= 0x309f) ||
      (c >= 0x30a0 && c <= 0x30ff) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff)
    ) {
      return true;
    }
  }
  return false;
}

let fts5Available: boolean | null = null;

/**
 * Search the names table in the extended DB.
 * Japanese input → prefix match on kanji and kana columns (indexed).
 * English/romaji input → romaji→kana prefix match + FTS5 on translation (with LIKE fallback).
 * Results are merged, deduped, and ranked.
 */
export async function searchNames(
  extDb: SQLiteDatabase,
  query: string,
  limit: number = 30,
  filter: NameFilter = "all",
): Promise<NameEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const categoryClause = filter !== "all" ? " AND category = ?" : "";
  const categoryParam = filter !== "all" ? [filter] : [];

  try {
    if (hasJapanese(trimmed)) {
      return await searchJapanese(extDb, trimmed, limit, categoryClause, categoryParam);
    } else {
      return await searchEnglishRomaji(extDb, trimmed, limit, categoryClause, categoryParam);
    }
  } catch {
    // Names table may not exist yet
    return [];
  }
}

/** Japanese input: prefix match on kanji and kana using B-tree indexes. */
async function searchJapanese(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
  categoryClause: string,
  categoryParam: string[],
): Promise<NameEntry[]> {
  const hiragana = toHiragana(input);
  const rows = await extDb.getAllAsync<NameRow>(
    `SELECT id, kanji, kana, name_type, translation FROM names
     WHERE (kanji LIKE ? OR kana LIKE ?)${categoryClause}
     ORDER BY CASE
       WHEN kanji = ? OR kana = ? THEN 0
       WHEN kanji LIKE ? OR kana LIKE ? THEN 1
       ELSE 2
     END, LENGTH(kana) ASC
     LIMIT ?`,
    [
      `${input}%`,
      `${hiragana}%`,
      ...categoryParam,
      input,
      hiragana,
      `${input}%`,
      `${hiragana}%`,
      limit,
    ],
  );
  return rows.map(toNameEntry);
}

/**
 * English/romaji input:
 * 1. Convert to hiragana → prefix match on kana (fast, indexed)
 * 2. FTS5 MATCH on translation (with LIKE fallback)
 * 3. Merge + dedup, kana matches first
 */
async function searchEnglishRomaji(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
  categoryClause: string,
  categoryParam: string[],
): Promise<NameEntry[]> {
  const hiragana = toHiragana(input.toLowerCase());
  const seen = new Set<number>();
  const results: NameEntry[] = [];

  // 1. Romaji→kana prefix match (fast, uses B-tree index)
  if (hiragana && hiragana !== input.toLowerCase()) {
    const kanaRows = await extDb.getAllAsync<NameRow>(
      `SELECT id, kanji, kana, name_type, translation FROM names
       WHERE kana LIKE ?${categoryClause}
       ORDER BY CASE
         WHEN kana = ? THEN 0
         WHEN kana LIKE ? THEN 1
         ELSE 2
       END, LENGTH(kana) ASC
       LIMIT ?`,
      [`${hiragana}%`, ...categoryParam, hiragana, `${hiragana}%`, limit],
    );
    for (const row of kanaRows) {
      seen.add(row.id);
      results.push(toNameEntry(row));
    }
  }

  // 2. Translation search — FTS5 with LIKE fallback
  const remaining = limit - results.length;
  if (remaining > 0) {
    const translationRows = await searchTranslation(
      extDb,
      input,
      remaining + seen.size, // fetch extra to account for dedup
      categoryClause,
      categoryParam,
    );
    for (const row of translationRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push(toNameEntry(row));
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}

/** Search translation column: try FTS5 first, fall back to LIKE. */
async function searchTranslation(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
  categoryClause: string,
  categoryParam: string[],
): Promise<NameRow[]> {
  if (fts5Available === false) {
    return searchTranslationLike(extDb, input, limit, categoryClause, categoryParam);
  }

  try {
    const results = await searchTranslationFts(extDb, input, limit, categoryClause, categoryParam);
    fts5Available = true;
    return results;
  } catch (e) {
    if (fts5Available === null && String(e).includes("fts5")) {
      console.warn("[Names] FTS5 not available, falling back to LIKE");
      fts5Available = false;
      return searchTranslationLike(extDb, input, limit, categoryClause, categoryParam);
    }
    throw e;
  }
}

/** FTS5 MATCH on names_fts, ranked by BM25. */
async function searchTranslationFts(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
  categoryClause: string,
  categoryParam: string[],
): Promise<NameRow[]> {
  // Escape FTS5 special characters and build query
  const escaped = input.replace(/['"*()^]/g, "");
  if (!escaped) return [];

  // Try prefix match first for partial words
  const ftsQuery = `"${escaped}"*`;

  return extDb.getAllAsync<NameRow>(
    `SELECT n.id, n.kanji, n.kana, n.name_type, n.translation
     FROM names_fts fts
     JOIN names n ON fts.rowid = n.id
     WHERE names_fts MATCH ?${categoryClause}
     ORDER BY rank
     LIMIT ?`,
    [ftsQuery, ...categoryParam, limit],
  );
}

/** LIKE fallback for translation search when FTS5 is not available. */
async function searchTranslationLike(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
  categoryClause: string,
  categoryParam: string[],
): Promise<NameRow[]> {
  const lower = input.toLowerCase();
  return extDb.getAllAsync<NameRow>(
    `SELECT id, kanji, kana, name_type, translation FROM names
     WHERE translation LIKE ?${categoryClause}
     ORDER BY CASE
       WHEN translation LIKE ? THEN 0
       WHEN translation LIKE ? THEN 1
       ELSE 2
     END, LENGTH(kana) ASC
     LIMIT ?`,
    [`%${lower}%`, ...categoryParam, `${lower}%`, `% ${lower}%`, limit],
  );
}

interface NameRow {
  id: number;
  kanji: string | null;
  kana: string;
  name_type: string | null;
  translation: string | null;
}

function toNameEntry(row: NameRow): NameEntry {
  return {
    id: row.id,
    kanji: row.kanji,
    kana: row.kana,
    nameType: row.name_type,
    translation: row.translation,
  };
}
