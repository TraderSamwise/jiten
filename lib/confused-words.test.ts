import { describe, test, expect } from "vitest";
import {
  isKanji,
  getKanaTemplate,
  matchesKanaTemplate,
  shouldCheckConfusion,
} from "./confused-words";

describe("isKanji", () => {
  test("CJK characters return true", () => {
    expect(isKanji("食")).toBe(true);
    expect(isKanji("漢")).toBe(true);
    expect(isKanji("字")).toBe(true);
    expect(isKanji("活")).toBe(true);
    expect(isKanji("気")).toBe(true);
  });

  test("hiragana/katakana return false", () => {
    expect(isKanji("あ")).toBe(false);
    expect(isKanji("べ")).toBe(false);
    expect(isKanji("る")).toBe(false);
    expect(isKanji("ア")).toBe(false);
    expect(isKanji("カ")).toBe(false);
  });

  test("latin/numbers return false", () => {
    expect(isKanji("a")).toBe(false);
    expect(isKanji("Z")).toBe(false);
    expect(isKanji("1")).toBe(false);
    expect(isKanji("!")).toBe(false);
  });
});

describe("getKanaTemplate", () => {
  test("食べる → template with kanji at position 0", () => {
    const result = getKanaTemplate("食べる");
    expect(result).toEqual({
      template: ["K", "べ", "る"],
      kanjiPositions: [0],
    });
  });

  test("活気 → all kanji positions", () => {
    const result = getKanaTemplate("活気");
    expect(result).toEqual({
      template: ["K", "K"],
      kanjiPositions: [0, 1],
    });
  });

  test("たべる → null (no kanji)", () => {
    expect(getKanaTemplate("たべる")).toBeNull();
  });

  test("食う → kanji at position 0", () => {
    const result = getKanaTemplate("食う");
    expect(result).toEqual({
      template: ["K", "う"],
      kanjiPositions: [0],
    });
  });

  test("お願い → kanji in the middle", () => {
    const result = getKanaTemplate("お願い");
    expect(result).toEqual({
      template: ["お", "K", "い"],
      kanjiPositions: [1],
    });
  });
});

describe("matchesKanaTemplate", () => {
  test("飲める does not match [K, べ, る] (め ≠ べ)", () => {
    expect(matchesKanaTemplate("飲める", ["K", "べ", "る"])).toBe(false);
  });

  test("飲む does not match [K, う] (む ≠ う)", () => {
    expect(matchesKanaTemplate("飲む", ["K", "う"])).toBe(false);
  });

  test("演説 matches [K, K]", () => {
    expect(matchesKanaTemplate("演説", ["K", "K"])).toBe(true);
  });

  test("食べた does not match [K, べ, る] (た ≠ る)", () => {
    expect(matchesKanaTemplate("食べた", ["K", "べ", "る"])).toBe(false);
  });

  test("活 does not match [K, K] (length mismatch)", () => {
    expect(matchesKanaTemplate("活", ["K", "K"])).toBe(false);
  });

  test("飲べる matches [K, べ, る]", () => {
    expect(matchesKanaTemplate("飲べる", ["K", "べ", "る"])).toBe(true);
  });

  test("all-kana word does not match all-kanji template at kanji positions", () => {
    expect(matchesKanaTemplate("あい", ["K", "K"])).toBe(false);
  });
});

describe("shouldCheckConfusion", () => {
  test("reps=4, lapses=3 → false (< 5 reps)", () => {
    expect(shouldCheckConfusion(4, 3)).toBe(false);
  });

  test("reps=5, lapses=1 → false (ratio 20%)", () => {
    expect(shouldCheckConfusion(5, 1)).toBe(false);
  });

  test("reps=5, lapses=3 → true (ratio 60%)", () => {
    expect(shouldCheckConfusion(5, 3)).toBe(true);
  });

  test("reps=10, lapses=5 → true (ratio 50%)", () => {
    expect(shouldCheckConfusion(10, 5)).toBe(true);
  });

  test("reps=10, lapses=3 → false (ratio 30%)", () => {
    expect(shouldCheckConfusion(10, 3)).toBe(false);
  });
});
