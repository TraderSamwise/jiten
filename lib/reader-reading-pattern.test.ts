import { describe, it, expect } from "vitest";
import type { KanjiCharacter } from "@/db/types";
import { classifyReaderReadingPattern } from "./reader-reading-pattern";

function makeKanji(
  literal: string,
  readingsOn: string[],
  readingsKun: string[],
  nanori: string[] = [],
): KanjiCharacter {
  return {
    literal,
    grade: null,
    strokeCount: 1,
    frequencyRank: null,
    jlptOld: null,
    jlptLevel: null,
    readingsOn,
    readingsKun,
    meanings: [],
    nanori,
    radicalClassical: null,
    radicalNelson: null,
    heisigIndex: null,
    unicodeCodepoint: "",
    strokePaths: [],
    heisigKeyword: null,
    heisigLesson: null,
  };
}

function makeMap(...kanji: KanjiCharacter[]): Map<string, KanjiCharacter> {
  return new Map(kanji.map((entry) => [entry.literal, entry]));
}

describe("classifyReaderReadingPattern", () => {
  it("classifies clear onyomi compounds", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "学校",
      kanaForm: "がっこう",
      kanjiByLiteral: makeMap(
        makeKanji("学", ["ガク"], ["まな.ぶ"]),
        makeKanji("校", ["コウ"], []),
      ),
    });
    expect(pattern).toBe("mostly_onyomi");
  });

  it("classifies clear kunyomi words with okurigana", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "食べる",
      kanaForm: "たべる",
      kanjiByLiteral: makeMap(makeKanji("食", ["ショク"], ["た.べる"])),
    });
    expect(pattern).toBe("mostly_kunyomi");
  });

  it("classifies mixed on/kun compounds", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "重箱",
      kanaForm: "じゅうばこ",
      kanjiByLiteral: makeMap(
        makeKanji("重", ["ジュウ"], ["おも.い"]),
        makeKanji("箱", ["ソウ"], ["はこ"]),
      ),
    });
    expect(pattern).toBe("mixed_on_kun");
  });

  it("treats explicit irregular readings as irregular", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "今日",
      kanaForm: "きょう",
      irregularReading: true,
      kanjiByLiteral: makeMap(
        makeKanji("今", ["コン"], ["いま"]),
        makeKanji("日", ["ニチ"], ["ひ", "か"]),
      ),
    });
    expect(pattern).toBe("irregular");
  });

  it("falls back to irregular when no alignment works", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "今日",
      kanaForm: "きょう",
      kanjiByLiteral: makeMap(
        makeKanji("今", ["コン"], ["いま"]),
        makeKanji("日", ["ニチ"], ["ひ", "か"]),
      ),
    });
    expect(pattern).toBe("irregular");
  });

  it("handles rendaku on kunyomi compounds", () => {
    const pattern = classifyReaderReadingPattern({
      kanjiForm: "手紙",
      kanaForm: "てがみ",
      kanjiByLiteral: makeMap(makeKanji("手", ["シュ"], ["て"]), makeKanji("紙", ["シ"], ["かみ"])),
    });
    expect(pattern).toBe("mostly_kunyomi");
  });
});
