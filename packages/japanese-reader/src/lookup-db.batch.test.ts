/**
 * lookupExactJapaneseMany exists only to save round trips, so the property that
 * matters is that it answers exactly what asking one word at a time answers —
 * same entries, same order, for hits and misses alike.
 */
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import type { ReaderSqlDb } from "./backend";
import { lookupExactJapanese, lookupExactJapaneseMany } from "./lookup-db";

const describeWithDb = hasDictDb ? describe : describe.skip;

describeWithDb("lookupExactJapaneseMany", () => {
  let raw: Database.Database;
  let db: ReaderSqlDb;

  beforeAll(() => {
    raw = new Database(DICT_DB_PATH, { readonly: true });
    db = {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? raw.prepare(sql).all(...(params as never[])) : raw.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? raw.prepare(sql).get(...(params as never[])) : raw.prepare(sql).get()) as T) ??
        null,
    };
  });

  afterAll(() => raw.close());

  const words = [
    "気を持たせる", // an expression, kanji spelling
    "きをもたせる", // the same entry's kana spelling
    "目の玉が飛び出る",
    "食べる",
    "タベル", // katakana folded to the kana form
    "一度",
    "1度", // digits normalised to kanji
    "役にも立たない",
    "こう", // dozens of entries, so their order is worth pinning
    "コーヒー", // katakana headword: reachable only as written, not via toHiragana
    "ぞんざいなあいさつをする言い回し", // no such entry
    "がが",
    "",
  ];

  it("answers the same as one lookup at a time", async () => {
    const batched = await lookupExactJapaneseMany(db, words);
    for (const word of words) {
      const single = await lookupExactJapanese(db, word);
      expect(batched.get(word)?.map((entry) => entry.id) ?? []).toEqual(
        single.map((entry) => entry.id),
      );
    }
  });

  it("keeps a many-entry word's entries in the same order as a single lookup", async () => {
    const batched = await lookupExactJapaneseMany(db, ["こう"]);
    const single = await lookupExactJapanese(db, "こう");
    expect(single.length).toBeGreaterThan(10);
    expect(batched.get("こう")?.map((entry) => entry.id)).toEqual(single.map((entry) => entry.id));
  });

  /**
   * コーヒー is written in katakana in the dictionary too, and toHiragana turns
   * it into こーひー, which matches nothing. Only the surface as written finds it.
   */
  it("finds a katakana headword by the surface as written", async () => {
    const batched = await lookupExactJapaneseMany(db, ["コーヒー"]);
    expect(batched.get("コーヒー")?.length).toBeGreaterThan(0);
  });

  it("returns an entry for every word asked about, empty where there is none", async () => {
    const batched = await lookupExactJapaneseMany(db, words);
    for (const word of words) expect(batched.has(word)).toBe(true);
    expect(batched.get("ぞんざいなあいさつをする言い回し")).toEqual([]);
  });

  it("keeps entries whole, not just their ids", async () => {
    const batched = await lookupExactJapaneseMany(db, ["気を持たせる"]);
    const [entry] = batched.get("気を持たせる") ?? [];
    expect(entry?.kanji.some((kanji) => kanji.text === "気を持たせる")).toBe(true);
    expect(entry?.senses.length).toBeGreaterThan(0);
  });

  it("handles more surfaces than fit in one bound-parameter chunk", async () => {
    const filler = Array.from({ length: 900 }, (_, i) => `のべつまくなし${i}`);
    const batched = await lookupExactJapaneseMany(db, [...filler, "食べる"]);
    expect(batched.size).toBe(901);
    expect(batched.get("食べる")?.length).toBeGreaterThan(0);
    expect(batched.get(filler[0])).toEqual([]);
  });

  it("asks nothing of the database for an empty list", async () => {
    let queries = 0;
    const counting: ReaderSqlDb = {
      getAllAsync: async <T>() => {
        queries++;
        return [] as T[];
      },
      getFirstAsync: async <T>() => {
        queries++;
        return null as T;
      },
    };
    expect((await lookupExactJapaneseMany(counting, [])).size).toBe(0);
    expect(queries).toBe(0);
  });
});
