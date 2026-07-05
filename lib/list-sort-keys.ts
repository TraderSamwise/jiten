import type * as SQLite from "expo-sqlite";
import type { SortMode } from "@/stores/list-sort";

export type SortRow = { entry_id: number; kanji_literal: string | null };

// SQLite variable-limit safety; matches the 500 cap used elsewhere in db/search.ts.
const CHUNK = 500;

async function chunkedIn<T>(
  db: SQLite.SQLiteDatabase,
  sql: (placeholders: string) => string,
  keys: (string | number)[],
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = keys.slice(i, i + CHUNK);
    const placeholders = batch.map(() => "?").join(",");
    out.push(...(await db.getAllAsync<T>(sql(placeholders), batch)));
  }
  return out;
}

/** Re-sort list rows by a dict-derived key (dict tables can't join list_entries).
 *  Ascending "most relevant first" (low heisig/strokes/rank, high word priority);
 *  rows with no value for the mode (e.g. a word under Heisig) sort last. Stable. */
export async function sortRowsByDictKey(
  dictDb: SQLite.SQLiteDatabase,
  rows: SortRow[],
  mode: SortMode,
): Promise<SortRow[]> {
  if (mode !== "freq" && mode !== "heisig" && mode !== "strokes") return rows;

  const kanjiLiterals = rows
    .filter((r) => r.kanji_literal != null)
    .map((r) => r.kanji_literal as string);
  const wordIds = rows.filter((r) => r.kanji_literal == null).map((r) => r.entry_id);

  const kanjiVal = new Map<string, number>();
  const wordVal = new Map<number, number>();

  if (kanjiLiterals.length) {
    const krows = await chunkedIn<{
      literal: string;
      heisig_index: number | null;
      stroke_count: number;
      frequency_rank: number | null;
    }>(
      dictDb,
      (ph) =>
        `SELECT literal, heisig_index, stroke_count, frequency_rank FROM kanji_characters WHERE literal IN (${ph})`,
      kanjiLiterals,
    );
    for (const k of krows) {
      const v =
        mode === "heisig" ? k.heisig_index : mode === "strokes" ? k.stroke_count : k.frequency_rank;
      if (v != null) kanjiVal.set(k.literal, v);
    }
  }

  // Words only carry a frequency notion (priority + common*50, the app's own score);
  // negated so higher frequency yields a smaller value = earlier under ascending sort.
  if (wordIds.length && mode === "freq") {
    const wrows = await chunkedIn<{ id: number; priority: number; common: number }>(
      dictDb,
      (ph) => `SELECT id, priority, common FROM entries WHERE id IN (${ph})`,
      wordIds,
    );
    for (const w of wrows) wordVal.set(w.id, -(w.priority + w.common * 50));
  }

  const MISSING = Number.POSITIVE_INFINITY;
  const valueOf = (r: SortRow): number => {
    const v = r.kanji_literal != null ? kanjiVal.get(r.kanji_literal) : wordVal.get(r.entry_id);
    return v ?? MISSING;
  };

  return rows
    .map((r, i) => ({ r, i, v: valueOf(r) }))
    .sort((a, b) => a.v - b.v || a.i - b.i)
    .map((x) => x.r);
}
