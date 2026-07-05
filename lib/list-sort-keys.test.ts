import type * as SQLite from "expo-sqlite";
import { describe, expect, it } from "vitest";
import { sortRowsByDictKey, type SortRow } from "./list-sort-keys";

// Minimal fake dict DB: answers the two IN(...) queries this module issues.
function fakeDict(
  kanji: Record<
    string,
    { heisig_index: number | null; stroke_count: number; frequency_rank: number | null }
  >,
  words: Record<number, { priority: number; common: number }>,
) {
  return {
    async getAllAsync<T>(sql: string, params: (string | number)[]): Promise<T[]> {
      if (sql.includes("kanji_characters")) {
        return params
          .filter((p) => kanji[p as string])
          .map((p) => ({ literal: p as string, ...kanji[p as string] })) as T[];
      }
      return params
        .filter((p) => words[p as number])
        .map((p) => ({ id: p as number, ...words[p as number] })) as T[];
    },
  } as unknown as SQLite.SQLiteDatabase;
}

const K = (literal: string): SortRow => ({ entry_id: 0, kanji_literal: literal });
const W = (id: number): SortRow => ({ entry_id: id, kanji_literal: null });
const lits = (rows: SortRow[]) => rows.map((r) => r.kanji_literal ?? r.entry_id);

describe("sortRowsByDictKey", () => {
  const dict = fakeDict(
    {
      日: { heisig_index: 12, stroke_count: 4, frequency_rank: 1 },
      一: { heisig_index: 1, stroke_count: 1, frequency_rank: 2 },
      鬱: { heisig_index: 2097, stroke_count: 29, frequency_rank: null },
    },
    { 100: { priority: 5, common: 1 }, 200: { priority: 40, common: 0 } },
  );

  it("passes non-dict modes through unchanged", async () => {
    const rows = [K("日"), K("一")];
    expect(await sortRowsByDictKey(dict, rows, "list")).toBe(rows);
    expect(await sortRowsByDictKey(dict, rows, "added")).toBe(rows);
  });

  it("sorts by heisig index ascending", async () => {
    const out = await sortRowsByDictKey(dict, [K("鬱"), K("日"), K("一")], "heisig");
    expect(lits(out)).toEqual(["一", "日", "鬱"]);
  });

  it("sorts by stroke count ascending", async () => {
    const out = await sortRowsByDictKey(dict, [K("鬱"), K("日"), K("一")], "strokes");
    expect(lits(out)).toEqual(["一", "日", "鬱"]);
  });

  it("sorts kanji by frequency_rank ascending, missing rank last", async () => {
    const out = await sortRowsByDictKey(dict, [K("鬱"), K("一"), K("日")], "freq");
    expect(lits(out)).toEqual(["日", "一", "鬱"]); // rank 1, 2, then null
  });

  it("sorts words by priority+common*50 descending under freq", async () => {
    const out = await sortRowsByDictKey(dict, [W(200), W(100)], "freq");
    expect(lits(out)).toEqual([100, 200]); // 100 scores 5+50=55, 200 scores 40 -> 100 first
  });

  it("is stable for equal/missing keys (words fall last under heisig)", async () => {
    const out = await sortRowsByDictKey(dict, [K("日"), W(100), K("一")], "heisig");
    expect(lits(out)).toEqual(["一", "日", 100]); // words have no heisig -> last, kanji keep order
  });
});
