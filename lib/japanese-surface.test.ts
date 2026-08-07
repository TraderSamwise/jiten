import { describe, expect, test } from "vitest";

import { matchesHeadword, occurrences } from "./japanese-surface";

describe("occurrences", () => {
  test("counts non-overlapping hits", () => {
    expect(occurrences("毎朝パンを食べました。", "食べました")).toBe(1);
    expect(occurrences("本を読んで本を閉じた。", "本")).toBe(2);
    expect(occurrences("水を飲む。", "茶")).toBe(0);
  });

  test("advances past each match, so a repeated needle cannot loop forever", () => {
    expect(occurrences("ああああ", "ああ")).toBe(2);
  });
});

describe("matchesHeadword", () => {
  test("accepts conjugated forms that keep the headword kanji", () => {
    expect(matchesHeadword("食べました", "食べる")).toBe(true);
    expect(matchesHeadword("新しかった", "新しい")).toBe(true);
    expect(matchesHeadword("勉強しています", "勉強する")).toBe(true);
    expect(matchesHeadword("本", "本")).toBe(true);
  });

  test("rejects a surface belonging to a different word", () => {
    expect(matchesHeadword("本", "食べる")).toBe(false);
    expect(matchesHeadword("飲みました", "食べる")).toBe(false);
  });

  test("accepts an honorific prefix the headword does not carry", () => {
    expect(matchesHeadword("お待ちください", "待つ")).toBe(true);
    expect(matchesHeadword("ご飯", "飯")).toBe(true);
  });

  test("uses shared kanji when the headword starts with kana", () => {
    expect(matchesHeadword("お茶", "お茶")).toBe(true);
    expect(matchesHeadword("水", "お茶")).toBe(false);
  });

  test("accepts anything for a kana-only headword — there is nothing to anchor on", () => {
    expect(matchesHeadword("食べる", "たべる")).toBe(true);
  });
});
