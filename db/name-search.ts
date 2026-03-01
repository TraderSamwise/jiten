import type { SQLiteDatabase } from "expo-sqlite";
import { toHiragana } from "wanakana";
import type { NameEntry } from "./types";

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

/**
 * Search the names table in the extended DB.
 * Japanese input → match on kanji and kana columns.
 * English/romaji input → match on translation column.
 */
export async function searchNames(
  extDb: SQLiteDatabase,
  query: string,
  limit: number = 30,
): Promise<NameEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    if (hasJapanese(trimmed)) {
      // Japanese input: search kanji and kana
      const hiragana = toHiragana(trimmed);
      const rows = await extDb.getAllAsync<{
        id: number;
        kanji: string | null;
        kana: string;
        name_type: string | null;
        translation: string | null;
      }>(
        `SELECT id, kanji, kana, name_type, translation FROM names
         WHERE kanji LIKE ? OR kana LIKE ?
         ORDER BY CASE
           WHEN kanji = ? OR kana = ? THEN 0
           WHEN kanji LIKE ? OR kana LIKE ? THEN 1
           ELSE 2
         END
         LIMIT ?`,
        [`%${trimmed}%`, `%${hiragana}%`, trimmed, hiragana, `${trimmed}%`, `${hiragana}%`, limit],
      );
      return rows.map(toNameEntry);
    } else {
      // English/romaji input: search translation
      const lower = trimmed.toLowerCase();
      const rows = await extDb.getAllAsync<{
        id: number;
        kanji: string | null;
        kana: string;
        name_type: string | null;
        translation: string | null;
      }>(
        `SELECT id, kanji, kana, name_type, translation FROM names
         WHERE translation LIKE ?
         ORDER BY CASE
           WHEN translation LIKE ? THEN 0
           WHEN translation LIKE ? THEN 1
           ELSE 2
         END
         LIMIT ?`,
        [`%${lower}%`, `${lower}%`, `% ${lower}%`, limit],
      );
      return rows.map(toNameEntry);
    }
  } catch {
    // Names table may not exist yet
    return [];
  }
}

function toNameEntry(row: {
  id: number;
  kanji: string | null;
  kana: string;
  name_type: string | null;
  translation: string | null;
}): NameEntry {
  return {
    id: row.id,
    kanji: row.kanji,
    kana: row.kana,
    nameType: row.name_type,
    translation: row.translation,
  };
}
