import { describe, expect, it } from "vitest";
import { isKanjiNumeralRun, kanjiNumeralReading } from "./numerals";

describe("isKanjiNumeralRun", () => {
  it("accepts a run written only in numerals", () => {
    for (const run of ["四十三", "五十八", "九十四", "十", "百", "二千三百"]) {
      expect(isKanjiNumeralRun(run)).toBe(true);
    }
  });

  it("rejects anything carrying a non-numeral", () => {
    for (const run of ["四十三人", "五十嵐", "八千代", "一応", "", "43", "じゅう"]) {
      expect(isKanjiNumeralRun(run)).toBe(false);
    }
  });
});

describe("kanjiNumeralReading", () => {
  it("reads the numbers the book spells out", () => {
    expect(kanjiNumeralReading("四十三")).toBe("よんじゅうさん");
    expect(kanjiNumeralReading("五十八")).toBe("ごじゅうはち");
    expect(kanjiNumeralReading("九十四")).toBe("きゅうじゅうよん");
    expect(kanjiNumeralReading("二十三")).toBe("にじゅうさん");
  });

  it("reads bare digits and bare powers", () => {
    expect(kanjiNumeralReading("三")).toBe("さん");
    expect(kanjiNumeralReading("十")).toBe("じゅう");
    expect(kanjiNumeralReading("百")).toBe("ひゃく");
    expect(kanjiNumeralReading("千")).toBe("せん");
  });

  /** The sound changes are the whole reason this cannot be digit-by-digit. */
  it("applies the euphonic changes on 百 and 千", () => {
    expect(kanjiNumeralReading("三百")).toBe("さんびゃく");
    expect(kanjiNumeralReading("六百")).toBe("ろっぴゃく");
    expect(kanjiNumeralReading("八百")).toBe("はっぴゃく");
    expect(kanjiNumeralReading("三千")).toBe("さんぜん");
    expect(kanjiNumeralReading("八千")).toBe("はっせん");
  });

  it("carries the changes into a longer number", () => {
    expect(kanjiNumeralReading("三百六十八")).toBe("さんびゃくろくじゅうはち");
    expect(kanjiNumeralReading("千八百九十六")).toBe("せんはっぴゃくきゅうじゅうろく");
  });

  it("reads 万 and what hangs off it", () => {
    expect(kanjiNumeralReading("一万")).toBe("いちまん");
    expect(kanjiNumeralReading("二万五千")).toBe("にまんごせん");
  });

  it("returns nothing for what it cannot read", () => {
    expect(kanjiNumeralReading("四十三人")).toBeNull();
    expect(kanjiNumeralReading("")).toBeNull();
    expect(kanjiNumeralReading("十十")).toBeNull();
  });
});
