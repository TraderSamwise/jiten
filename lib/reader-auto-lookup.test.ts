import { describe, expect, it } from "vitest";
import type {
  ReaderDictEntry as DictEntry,
  ReaderNameEntry as NameEntry,
} from "../packages/japanese-reader/src/types";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import * as path from "path";
import {
  autoSelectionLookup,
  chooseAutoLookupResults,
  smartLookupWithOffset,
  type LookupResult,
} from "../packages/japanese-reader/src/lookup";
import * as lookupDb from "../packages/japanese-reader/src/lookup-db";
import { afterEach, vi } from "vitest";

function makeWordEntry(overrides?: Partial<DictEntry>): DictEntry {
  return {
    id: overrides?.id ?? 1,
    common: overrides?.common ?? false,
    jlptLevel: overrides?.jlptLevel ?? null,
    kanji: overrides?.kanji ?? [],
    kana: overrides?.kana ?? [],
    senses: overrides?.senses ?? [],
    pitchAccents: overrides?.pitchAccents ?? [],
  };
}

function makeNameEntry(overrides?: Partial<NameEntry>): NameEntry {
  return {
    id: overrides?.id ?? 1,
    kanji: overrides?.kanji ?? null,
    kana: overrides?.kana ?? "",
    nameType: overrides?.nameType ?? null,
    translation: overrides?.translation ?? null,
  };
}

function makeWordResult(
  matchedText: string,
  entries: DictEntry[],
  deinflectReasons: string[] = [],
): LookupResult {
  return {
    matchedText,
    entries,
    deinflectReasons,
    lookupKind: "word",
  };
}

function makeNameResult(matchedText: string, names: NameEntry[]): LookupResult {
  return {
    matchedText,
    entries: [],
    deinflectReasons: [],
    nameMatches: names,
    lookupKind: "name",
  };
}

describe("chooseAutoLookupResults name-length override", () => {
  // A place name is capped at 75 by the confidence score (place costs 16, a
  // competing common word costs 28) against a threshold of 90, so 大泉学園 could
  // never beat 泉 no matter how much longer and more exact it was.
  it("lets a 3+ char exact name beat a shorter word match", () => {
    const wordResults = [
      makeWordResult("泉", [
        makeWordEntry({ common: true, kanji: [{ text: "泉", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("大泉学園", [
        makeNameEntry({
          kanji: "大泉学園",
          kana: "おおいずみがくえん",
          nameType: "place",
          translation: "Ooizumigakuen",
        }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(nameResults);
  });

  // Two-kanji names straddling a word boundary are the noise this floor exists
  // for: 田先 falls out of 山田先生 and claims to be a surname.
  it("does not let a 2 char name beat a shorter word match", () => {
    const wordResults = [
      makeWordResult("田", [
        makeWordEntry({ common: true, kanji: [{ text: "田", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("田先", [
        makeNameEntry({ kanji: "田先", kana: "たさき", nameType: "surname" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });

  it("still prefers a word that covers the same span as the name", () => {
    const wordResults = [
      makeWordResult("朝鮮半島", [
        makeWordEntry({ common: true, kanji: [{ text: "朝鮮半島", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("朝鮮半島", [
        makeNameEntry({ kanji: "朝鮮半島", kana: "ちょうせんはんとう", nameType: "place" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)[0].lookupKind).toBe("word");
  });

  it("does not override on an inexact name match", () => {
    const wordResults = [
      makeWordResult("大", [
        makeWordEntry({ common: true, kanji: [{ text: "大", common: true, tags: [] }] }),
      ]),
    ];
    // kanji/kana neither equal the matched surface, so the match is not exact.
    const nameResults = [
      makeNameResult("大泉学", [
        makeNameEntry({ kanji: "大泉学園", kana: "おおいずみがくえん", nameType: "place" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });
});

describe("chooseAutoLookupResults", () => {
  it("prefers the longer match", () => {
    const wordResults = [
      makeWordResult("学校", [
        makeWordEntry({ common: true, kanji: [{ text: "学校", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("学", [makeNameEntry({ kanji: "学", kana: "がく", nameType: "person" })]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });

  it("prefers common exact word matches over equally long generic names", () => {
    const wordResults = [
      makeWordResult("花", [
        makeWordEntry({ common: true, kanji: [{ text: "花", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("花", [makeNameEntry({ kanji: "花", kana: "はな", nameType: "unclass" })]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });

  it("prefers strong exact names over deinflected uncommon word hits", () => {
    const wordResults = [
      makeWordResult(
        "太郎",
        [makeWordEntry({ common: false, kanji: [{ text: "垂れる", common: false, tags: [] }] })],
        ["past"],
      ),
    ];
    const nameResults = [
      makeNameResult("太郎", [
        makeNameEntry({ kanji: "太郎", kana: "たろう", nameType: "given", translation: "Taro" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(nameResults);
  });

  it("prefers a common exact word over an equally exact single-kanji name", () => {
    const wordResults = [
      makeWordResult("夢", [
        makeWordEntry({
          common: true,
          kanji: [{ text: "夢", common: true, tags: [] }],
          kana: [{ text: "ゆめ", common: true, tags: [], romaji: "yume" }],
        }),
      ]),
    ];
    const nameResults = [
      makeNameResult("夢", [
        makeNameEntry({ kanji: "夢", kana: "あゆみ", nameType: "given", translation: "Ayumi" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });

  it("prefers a normal word over a kana-only exact name match in prose-like ambiguity", () => {
    const wordResults = [
      makeWordResult("とうに", [
        makeWordEntry({
          common: true,
          kana: [{ text: "とうに", common: true, tags: [], romaji: "touni" }],
        }),
      ]),
    ];
    const nameResults = [
      makeNameResult("とうに", [
        makeNameEntry({ kanji: "唐丹", kana: "とうに", nameType: "place", translation: "Toni" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual(wordResults);
  });

  it("returns both top candidates when word and name hits are both strong and close", () => {
    const wordResults = [
      makeWordResult("花子", [
        makeWordEntry({ common: true, kanji: [{ text: "花子", common: true, tags: [] }] }),
      ]),
    ];
    const nameResults = [
      makeNameResult("花子", [
        makeNameEntry({ kanji: "花子", kana: "はなこ", nameType: "given", translation: "Hanako" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual([
      {
        ...wordResults[0],
        lookupKind: "word",
        alternateResults: [
          { ...wordResults[0], lookupKind: "word" },
          { ...nameResults[0], lookupKind: "name" },
        ],
      },
    ]);
  });

  it("returns word first with name alternate when an uncommon exact word competes with an exact surname", () => {
    const wordResults = [
      makeWordResult("造作", [
        makeWordEntry({
          common: false,
          kanji: [{ text: "造作", common: false, tags: [] }],
          kana: [{ text: "ぞうさ", common: false, tags: [], romaji: "zousa" }],
        }),
      ]),
    ];
    const nameResults = [
      makeNameResult("造作", [
        makeNameEntry({ kanji: "造作", kana: "ぞうさ", nameType: "surname", translation: "Zousa" }),
      ]),
    ];

    expect(chooseAutoLookupResults(wordResults, nameResults)).toEqual([
      {
        ...wordResults[0],
        lookupKind: "word",
        alternateResults: [
          { ...wordResults[0], lookupKind: "word" },
          { ...nameResults[0], lookupKind: "name" },
        ],
      },
    ]);
  });
});

describe("autoSelectionLookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps top-level segmented word results and nests word/name ambiguity per segment", async () => {
    vi.spyOn(lookupDb, "lookupExactJapanese").mockImplementation(async (_db, query) => {
      if (query === "第一") {
        return [
          makeWordEntry({ id: 1, common: true, kanji: [{ text: "第一", common: true, tags: [] }] }),
        ];
      }
      if (query === "夜") {
        return [
          makeWordEntry({ id: 2, common: true, kanji: [{ text: "夜", common: true, tags: [] }] }),
        ];
      }
      if (query === "こんな") {
        return [
          makeWordEntry({
            id: 3,
            common: true,
            kana: [{ text: "こんな", common: true, tags: [], romaji: "konna" }],
          }),
        ];
      }
      return [];
    });

    vi.spyOn(lookupDb, "lookupExactName").mockImplementation(async (_db, query) => {
      if (query === "第一") {
        return [makeNameEntry({ id: 11, kanji: "第一", kana: "だいいち", nameType: "person" })];
      }
      if (query === "夜") {
        return [makeNameEntry({ id: 12, kanji: "夜", kana: "よる", nameType: "unclass" })];
      }
      return [];
    });

    const results = await autoSelectionLookup("第一夜こんな", {} as ReaderSqlDb, {} as ReaderSqlDb);

    expect(results).toHaveLength(3);
    expect(results[0].matchedText).toBe("第一");
    expect(results[0].alternateResults?.map((result) => result.lookupKind)).toEqual([
      "word",
      "name",
    ]);
    expect(results[1].matchedText).toBe("夜");
    expect(results[1].alternateResults).toBeUndefined();
    expect(results[2].matchedText).toBe("こんな");
    expect(results[2].alternateResults).toBeUndefined();
  });
});

describe("compound verbs are not truncated to their first stem", () => {
  const dbPath = path.resolve(__dirname, "..", "assets", "dictionary.db");

  // shouldPreferShorterExactSurface used to prefer a shorter EXACT surface over a
  // longer DEINFLECTED one starting at the same place, so tapping the first kanji
  // of 受け合った gave 受け. Measured over 4000 characters of prose, dropping it
  // changed 83 taps: 38 distinct improvements against 1 regression.
  it.runIf(existsSync(dbPath))("resolves the whole verb from its first character", async () => {
    const db = new Database(dbPath, { readonly: true });
    const dictDb = {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? db.prepare(sql).get(...(params as never[])) : db.prepare(sql).get()) as T) ??
        null,
    };
    const cases: [string, string, string][] = [
      ["みせると受け合った。", "受", "受け合った"],
      ["をはすに切り込んだ。", "切", "切り込んだ"],
      ["せますと答えた。", "答", "答えた"],
      ["を垣根へ押しつけて", "押", "押しつけて"],
      ["つづけに取ったら、", "取", "取ったら"],
    ];
    for (const [text, tapChar, expected] of cases) {
      const results = await smartLookupWithOffset(text, text.indexOf(tapChar), dictDb, null);
      expect(results[0]?.matchedText, `tapping ${tapChar} in ${text}`).toBe(expected);
    }
    db.close();
  });
});
