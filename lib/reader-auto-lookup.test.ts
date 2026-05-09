import { describe, expect, it } from "vitest";
import type {
  ReaderDictEntry as DictEntry,
  ReaderNameEntry as NameEntry,
} from "../packages/japanese-reader/src/types";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";
import {
  autoSelectionLookup,
  chooseAutoLookupResults,
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
