import { describe, it, expect } from "vitest";
import {
  applyFuriganaToHtml,
  injectRubySpacers,
  type FuriganaEntry,
  type FuriganaKanjiSet,
} from "./reader-furigana";

const allKanji: FuriganaKanjiSet = { all: true, chars: new Set() };

function makeMap(entries: [string, string, string][]): Map<string, FuriganaEntry> {
  const map = new Map<string, FuriganaEntry>();
  for (const [surface, kanjiPart, reading] of entries) {
    map.set(surface, {
      kanjiPart,
      reading,
      kanjiPartLen: [...kanjiPart].length,
    });
  }
  return map;
}

describe("applyFuriganaToHtml", () => {
  it("should not match across </p><p> boundaries", () => {
    // Surface "男が" exists in the map. Input has "男" at end of one <p>
    // and "が" at start of the next. Should NOT match across the boundary.
    const map = makeMap([["男が傘", "男が傘", "おとこがかさ"]]);
    const html = "<p>花</p><p>男が傘に</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    // The match should still work within the same <p>
    expect(result).toContain("<ruby>男が傘<rt>おとこがかさ</rt></ruby>");
    expect(result).toContain("<p>花</p>");
  });

  it("should not consume characters from the next paragraph", () => {
    const map = makeMap([
      ["花屋", "花屋", "はなや"],
      ["男", "男", "おとこ"],
    ]);
    const html = "<p>花</p><p>や</p><p>男が傘に</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    // "花" should NOT match "花屋" across the </p><p> boundary
    expect(result).toContain("<p>花</p>");
    expect(result).toContain("<p>や</p>");
    expect(result).toContain("<ruby>男<rt>おとこ</rt></ruby>が傘に");
  });

  it("should not match surface across paragraph boundary (real case)", () => {
    const map = makeMap([
      ["花", "花", "はな"],
      ["傘", "傘", "かさ"],
      ["男が傘", "男が傘", "おとこがかさ"],
    ]);
    const html = "<p>おめでとう。花」</p><p>はな</p><p>や</p><p>男が傘にわたしを入れて</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    // All paragraphs must be preserved intact
    expect(result).toContain("<p>はな</p>");
    expect(result).toContain("<p>や</p>");
    // 男が傘 should match within its own <p>
    expect(result).toContain("<ruby>男が傘<rt>おとこがかさ</rt></ruby>にわたしを入れて");
  });

  it("should not match across boundaries with ruby spacers injected", () => {
    const map = makeMap([
      ["花", "花", "はな"],
      ["傘", "傘", "かさ"],
      ["男が傘", "男が傘", "おとこがかさ"],
    ]);
    const rawHtml = "<p>おめでとう。花」</p><p>はな</p><p>や</p><p>男が傘にわたしを入れて</p>";
    const withSpacers = injectRubySpacers(rawHtml);
    const result = applyFuriganaToHtml(withSpacers, map, allKanji);
    expect(result).toContain("はな</p>");
    expect(result).toContain("や</p>");
    expect(result).toContain("男が傘");
  });

  it("real book text: や paragraph and 男が傘 must be preserved", () => {
    // From 私の男: line 8=はな, line 9=や, line 10=男が傘にわたしを入れて...
    const map = makeMap([
      ["男", "男", "おとこ"],
      ["傘", "傘", "かさ"],
      ["肩", "肩", "かた"],
      ["引", "引", "ひ"],
      ["言", "言", "い"],
      ["入", "入", "い"],
      ["男が傘", "男が傘", "おとこがかさ"],
    ]);
    const html =
      "<p>「けっこん、おめでとう。花」</p><p>はな</p><p>や</p><p>男が傘にわたしを入れて、肩を引きよせながら言った。</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    console.log("REAL BOOK:", result);
    expect(result).toContain("はな</p>");
    expect(result).toContain("<p>や</p>");
    expect(result).toContain("男が傘");
  });

  it("cross-boundary: long surface consumes chars from next paragraph", () => {
    // If the dictionary has surface "花屋" and HTML has "花</p><p>屋根",
    // getVisibleCharsFrom skips the </p><p> and sees "花屋根".
    // It matches "花屋", then advanceHtmlPastChars consumes past the boundary.
    const map = makeMap([["花屋", "花屋", "はなや"]]);
    const html = "<p>花</p><p>屋根が</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);

    // Should NOT match across boundary — "花" stays in its <p>, "屋根が" stays intact
    expect(result).toContain("<p>花</p>");
    expect(result).toContain("屋根が");
  });
});
