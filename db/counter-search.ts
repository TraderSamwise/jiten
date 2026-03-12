import type { SQLiteDatabase } from "expo-sqlite";
import { toHiragana } from "wanakana";
import type { CounterEntry, CounterReading } from "./types";

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

interface CounterRow {
  counter_id: number;
  counter_kanji: string;
  counter_reading: string;
  counter_gloss: string | null;
  number: string;
  number_kanji: string;
  combined_kanji: string;
  reading: string;
}

function groupRows(rows: CounterRow[]): CounterEntry[] {
  const map = new Map<
    number,
    { entry: Omit<CounterEntry, "readings">; readings: CounterReading[] }
  >();

  for (const row of rows) {
    let group = map.get(row.counter_id);
    if (!group) {
      group = {
        entry: {
          counterId: row.counter_id,
          counterKanji: row.counter_kanji,
          counterReading: row.counter_reading,
          counterGloss: row.counter_gloss,
        },
        readings: [],
      };
      map.set(row.counter_id, group);
    }
    group.readings.push({
      number: row.number,
      numberKanji: row.number_kanji,
      combinedKanji: row.combined_kanji,
      reading: row.reading,
    });
  }

  return [...map.values()].map(({ entry, readings }) => ({ ...entry, readings }));
}

/**
 * Search counters in the extended DB.
 * Japanese input → prefix match on counter_kanji and counter_reading.
 * English/romaji input → romaji→kana match + LIKE on counter_gloss.
 * Returns full counter entries with all 11 readings each.
 */
export async function searchCounters(
  extDb: SQLiteDatabase,
  query: string,
  limit: number = 20,
): Promise<CounterEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const counterIds = hasJapanese(trimmed)
      ? await matchJapanese(extDb, trimmed, limit)
      : await matchEnglishRomaji(extDb, trimmed, limit);

    if (counterIds.length === 0) return [];

    // Fetch all readings for matched counters
    const placeholders = counterIds.map(() => "?").join(",");
    const rows = await extDb.getAllAsync<CounterRow>(
      `SELECT counter_id, counter_kanji, counter_reading, counter_gloss,
              number, number_kanji, combined_kanji, reading
       FROM counter_readings
       WHERE counter_id IN (${placeholders})
       ORDER BY counter_id, CASE number WHEN '何' THEN 11 ELSE CAST(number AS INTEGER) END`,
      counterIds,
    );

    return groupRows(rows);
  } catch {
    return [];
  }
}

/**
 * Get a single counter by ID with all its readings.
 */
export async function getCounter(
  extDb: SQLiteDatabase,
  counterId: number,
): Promise<CounterEntry | null> {
  const rows = await extDb.getAllAsync<CounterRow>(
    `SELECT counter_id, counter_kanji, counter_reading, counter_gloss,
            number, number_kanji, combined_kanji, reading
     FROM counter_readings
     WHERE counter_id = ?
     ORDER BY CASE number WHEN '何' THEN 11 ELSE CAST(number AS INTEGER) END`,
    [counterId],
  );

  if (rows.length === 0) return null;
  return groupRows(rows)[0];
}

/**
 * Get all noun JMdict IDs that use a given counter.
 */
export async function getNounsForCounter(
  extDb: SQLiteDatabase,
  counterId: number,
): Promise<number[]> {
  const rows = await extDb.getAllAsync<{ jmdict_id: number }>(
    `SELECT jmdict_id FROM noun_counter_mappings WHERE counter_id = ? ORDER BY jmdict_id`,
    [counterId],
  );
  return rows.map((r) => r.jmdict_id);
}

/**
 * Get counters for a given word (noun→counter lookup).
 * Returns minimal counter info for display on word detail pages.
 */
export async function getCountersForWord(
  extDb: SQLiteDatabase,
  jmdictId: number,
): Promise<
  { counterId: number; counterKanji: string; counterReading: string; counterGloss: string | null }[]
> {
  return extDb.getAllAsync(
    `SELECT DISTINCT cr.counter_id AS counterId, cr.counter_kanji AS counterKanji,
            cr.counter_reading AS counterReading, cr.counter_gloss AS counterGloss
     FROM noun_counter_mappings ncm
     JOIN counter_readings cr ON cr.counter_id = ncm.counter_id
     WHERE ncm.jmdict_id = ?
     ORDER BY cr.counter_id`,
    [jmdictId],
  );
}

/** Japanese input: match on counter_kanji or counter_reading (prefix). */
async function matchJapanese(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
): Promise<number[]> {
  const hiragana = toHiragana(input);
  const rows = await extDb.getAllAsync<{ counter_id: number }>(
    `SELECT DISTINCT counter_id FROM counter_readings
     WHERE counter_kanji LIKE ? OR counter_reading LIKE ?
           OR combined_kanji LIKE ? OR reading LIKE ?
     ORDER BY CASE
       WHEN counter_kanji = ? OR counter_reading = ? THEN 0
       WHEN counter_kanji LIKE ? OR counter_reading LIKE ? THEN 1
       ELSE 2
     END
     LIMIT ?`,
    [
      `${input}%`,
      `${hiragana}%`,
      `${input}%`,
      `${hiragana}%`,
      input,
      hiragana,
      `${input}%`,
      `${hiragana}%`,
      limit,
    ],
  );
  return rows.map((r) => r.counter_id);
}

/** English/romaji input: try romaji→kana match, then LIKE on gloss. */
async function matchEnglishRomaji(
  extDb: SQLiteDatabase,
  input: string,
  limit: number,
): Promise<number[]> {
  const seen = new Set<number>();
  const result: number[] = [];

  // 1. Romaji → kana prefix match
  const hiragana = toHiragana(input.toLowerCase());
  if (hiragana && hiragana !== input.toLowerCase()) {
    const kanaRows = await extDb.getAllAsync<{ counter_id: number }>(
      `SELECT DISTINCT counter_id FROM counter_readings
       WHERE counter_reading LIKE ?
       ORDER BY CASE
         WHEN counter_reading = ? THEN 0
         ELSE 1
       END
       LIMIT ?`,
      [`${hiragana}%`, hiragana, limit],
    );
    for (const row of kanaRows) {
      if (!seen.has(row.counter_id)) {
        seen.add(row.counter_id);
        result.push(row.counter_id);
      }
    }
  }

  // 2. English gloss LIKE match
  const remaining = limit - result.length;
  if (remaining > 0) {
    const lower = input.toLowerCase();
    const glossRows = await extDb.getAllAsync<{ counter_id: number }>(
      `SELECT DISTINCT counter_id FROM counter_readings
       WHERE counter_gloss LIKE ?
       ORDER BY CASE
         WHEN counter_gloss LIKE ? THEN 0
         WHEN counter_gloss LIKE ? THEN 1
         ELSE 2
       END
       LIMIT ?`,
      [`%${lower}%`, `${lower}%`, `% ${lower}%`, remaining + seen.size],
    );
    for (const row of glossRows) {
      if (!seen.has(row.counter_id)) {
        seen.add(row.counter_id);
        result.push(row.counter_id);
        if (result.length >= limit) break;
      }
    }
  }

  return result;
}
