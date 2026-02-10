import { describe, test, expect } from "vitest";
import { isJapanese, isKana, isKanji, guessWordLength, guessWordStart } from "./japanese";

describe("isJapanese", () => {
  test("returns true for kanji", () => {
    expect(isJapanese("漢")).toBe(true);
    expect(isJapanese("字")).toBe(true);
  });

  test("returns true for hiragana", () => {
    expect(isJapanese("あ")).toBe(true);
    expect(isJapanese("ん")).toBe(true);
  });

  test("returns true for katakana", () => {
    expect(isJapanese("ア")).toBe(true);
    expect(isJapanese("ン")).toBe(true);
  });

  test("returns true for CJK punctuation", () => {
    expect(isJapanese("々")).toBe(true);
  });

  test("returns false for ASCII", () => {
    expect(isJapanese("a")).toBe(false);
    expect(isJapanese("1")).toBe(false);
    expect(isJapanese(".")).toBe(false);
  });

  test("returns false for empty/null input", () => {
    expect(isJapanese("")).toBe(false);
  });
});

describe("isKana", () => {
  test("returns true for hiragana", () => {
    expect(isKana("あ")).toBe(true);
  });

  test("returns true for katakana", () => {
    expect(isKana("ア")).toBe(true);
  });

  test("returns false for kanji", () => {
    expect(isKana("漢")).toBe(false);
  });
});

describe("isKanji", () => {
  test("returns true for kanji", () => {
    expect(isKanji("漢")).toBe(true);
  });

  test("returns false for kana", () => {
    expect(isKanji("あ")).toBe(false);
    expect(isKanji("ア")).toBe(false);
  });
});

describe("guessWordLength", () => {
  test("handles kanji + okurigana (走って読む)", () => {
    expect(guessWordLength("走って読む")).toBe(3); // 走って
  });

  test("handles pure kanji", () => {
    expect(guessWordLength("東京都")).toBe(3);
  });

  test("handles pure kana", () => {
    expect(guessWordLength("おはよう")).toBe(4);
  });

  test("handles single kanji + kana", () => {
    expect(guessWordLength("食べる")).toBe(3);
  });

  test("returns 0 for empty input", () => {
    expect(guessWordLength("")).toBe(0);
  });

  test("returns 1 for non-Japanese first character", () => {
    expect(guessWordLength("abc")).toBe(1);
  });
});

describe("guessWordStart", () => {
  test("finds start of kanji run", () => {
    expect(guessWordStart("走って", 0)).toBe(0);
  });

  test("scans back through kana to kanji", () => {
    // Tapping on って in 走って should find 走 as start
    expect(guessWordStart("走って", 2)).toBe(0);
  });

  test("scans back through kanji only for kanji tap", () => {
    expect(guessWordStart("東京都", 2)).toBe(0);
  });

  test("stays at position for non-Japanese", () => {
    expect(guessWordStart("abc", 1)).toBe(1);
  });
});
