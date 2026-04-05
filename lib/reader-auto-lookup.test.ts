import { describe, expect, it } from "vitest";
import type { DictEntry, NameEntry } from "@/db/types";
import { chooseAutoLookupResults, type LookupResult } from "./smart-lookup";

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
