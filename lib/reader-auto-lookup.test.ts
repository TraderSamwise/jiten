import { describe, expect, it } from "vitest";
import type { DictEntry, NameEntry } from "@/db/types";
import { autoSelectionLookup, chooseAutoLookupResults, type LookupResult } from "./smart-lookup";
import * as searchDb from "@/db/search";
import * as nameSearchDb from "@/db/name-search";
import * as sqlite from "expo-sqlite";
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
      { ...nameResults[0], lookupKind: "name" },
      { ...wordResults[0], lookupKind: "word" },
    ]);
  });
});

describe("autoSelectionLookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps top-level segmented word results and nests word/name ambiguity per segment", async () => {
    vi.spyOn(searchDb, "lookupExactJapanese").mockImplementation(async (_db, query) => {
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

    vi.spyOn(nameSearchDb, "lookupExactName").mockImplementation(async (_db, query) => {
      if (query === "第一") {
        return [makeNameEntry({ id: 11, kanji: "第一", kana: "だいいち", nameType: "person" })];
      }
      if (query === "夜") {
        return [makeNameEntry({ id: 12, kanji: "夜", kana: "よる", nameType: "unclass" })];
      }
      return [];
    });

    const results = await autoSelectionLookup(
      "第一夜こんな",
      {} as sqlite.SQLiteDatabase,
      {} as sqlite.SQLiteDatabase,
    );

    expect(results).toHaveLength(3);
    expect(results[0].matchedText).toBe("第一");
    expect(results[0].alternateResults?.map((result) => result.lookupKind)).toEqual([
      "name",
      "word",
    ]);
    expect(results[1].matchedText).toBe("夜");
    expect(results[1].alternateResults).toBeUndefined();
    expect(results[2].matchedText).toBe("こんな");
    expect(results[2].alternateResults).toBeUndefined();
  });
});
