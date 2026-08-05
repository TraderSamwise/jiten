import type { ReaderKanjiCharacter } from "@tradersamwise/jiten-reader-core";
import type { ReaderSqlDb } from "./backend";

interface KanjiReadingRow {
  literal: string;
  readings_on: string | null;
  readings_kun: string | null;
  nanori: string | null;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function getKanjiBatchAsync(
  db: ReaderSqlDb,
  literals: string[],
): Promise<ReaderKanjiCharacter[]> {
  if (literals.length === 0) return [];
  const placeholders = literals.map(() => "?").join(", ");
  const rows = await db.getAllAsync<KanjiReadingRow>(
    `SELECT literal, readings_on, readings_kun, nanori
     FROM kanji_characters
     WHERE literal IN (${placeholders})`,
    literals,
  );
  return rows.map((row) => ({
    literal: row.literal,
    readingsOn: parseStringArray(row.readings_on),
    readingsKun: parseStringArray(row.readings_kun),
    nanori: parseStringArray(row.nanori),
  }));
}

export async function getKanjiLiteralsByJlptAsync(
  db: ReaderSqlDb,
  level: number | null,
): Promise<string[]> {
  const sql =
    level === null
      ? "SELECT literal FROM kanji_characters WHERE jlpt_level IS NULL"
      : "SELECT literal FROM kanji_characters WHERE jlpt_level = ?";
  const rows = await db.getAllAsync<{ literal: string }>(sql, level === null ? [] : [level]);
  return rows.map((row) => row.literal);
}
