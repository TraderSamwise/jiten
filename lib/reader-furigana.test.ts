import { describe, it, expect } from "vitest";
import {
  applyFuriganaToHtml,
  defaultReaderFuriganaSettings,
  injectRubySpacers,
  extractSurfacesFromHtml,
  type FuriganaEntry,
  type FuriganaKanjiSet,
  type ReaderFuriganaSettings,
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

  it("partial level filter: whole word gets furigana if any kanji matches", () => {
    // 反省会: 反=N5, 省=N3, 会=N5. With only N3 selected, 省 matches.
    // The whole word 反省会 should get furigana (はんせいかい), not just 省 alone.
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMap([
      ["反省会", "反省会", "はんせいかい"],
      ["省", "省", "しょう"],
    ]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(html, map, n3Only);
    expect(result).toContain("<ruby>反省会<rt>はんせいかい</rt></ruby>");
    expect(result).not.toContain("<ruby>省<rt>しょう</rt></ruby>");
  });

  it("partial level filter: extractSurfacesFromHtml includes words containing filtered kanji", () => {
    // With N3 filter where only 省 matches, we still need to extract "反省会"
    // as a surface so the dictionary lookup can find the whole word.
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const html = "<p>反省会をする</p>";
    const surfaces = extractSurfacesFromHtml(html, n3Only);
    // Must include surfaces starting from 反 (because 省 is nearby and matches)
    expect(surfaces).toContain("反省会");
  });

  it("partial level filter: single kanji word still works", () => {
    // If only the matching kanji appears alone, it should still get furigana
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMap([["省", "省", "しょう"]]);
    const html = "<p>省の</p>";
    const result = applyFuriganaToHtml(html, map, n3Only);
    expect(result).toContain("<ruby>省<rt>しょう</rt></ruby>");
  });

  it("partial level filter: no furigana when no kanji in word matches filter", () => {
    // 反対 — neither 反(N5) nor 対(N4) matches N3 filter
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMap([["反対", "反対", "はんたい"]]);
    const html = "<p>反対する</p>";
    const result = applyFuriganaToHtml(html, map, n3Only);
    expect(result).not.toContain("<ruby>");
  });

  it("mixed kana-kanji word: しょう油 gets furigana, not 油=あぶら", () => {
    const map = makeMap([
      ["しょう油", "しょう油", "しょうゆ"],
      ["油", "油", "あぶら"],
    ]);
    const html = "<p>しょう油をかける</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    // Should match しょう油 (longest match), not just 油=あぶら
    expect(result).toContain("しょうゆ");
    expect(result).not.toContain("あぶら");
  });

  it("mixed kana-kanji: お寺 gets furigana", () => {
    const map = makeMap([
      ["お寺", "お寺", "おてら"],
      ["寺", "寺", "てら"],
    ]);
    const html = "<p>お寺に行く</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    expect(result).toContain("おてら");
    expect(result).not.toContain("<ruby>寺<rt>てら</rt></ruby>");
  });

  it("mixed kana-kanji: kana before kanji without match falls through", () => {
    // Random kana before kanji should NOT cause issues if no dictionary match
    const map = makeMap([["油", "油", "あぶら"]]);
    const html = "<p>ます油がある</p>";
    const result = applyFuriganaToHtml(html, map, allKanji);
    // 油 should still get its own furigana (ます油 not in map)
    expect(result).toContain("<ruby>油<rt>あぶら</rt></ruby>");
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

// ─── Word-level JLPT filtering tests ───
// These test the algorithm for three categories of words, using mock JLPT data.
// The kanji JLPT levels in the mock kanjiSets and word JLPT levels in the map
// entries are fabricated to exercise each category. When the real DB JLPT data
// is rederived (e.g. from a better corpus), these tests should be revisited
// to ensure the mock values still represent realistic scenarios.

function makeMapWithJlpt(
  entries: [string, string, string, number | null, boolean?][],
): Map<string, FuriganaEntry> {
  const map = new Map<string, FuriganaEntry>();
  for (const [surface, kanjiPart, reading, wordJlpt, irregularReading] of entries) {
    map.set(surface, {
      kanjiPart,
      reading,
      kanjiPartLen: [...kanjiPart].length,
      wordJlpt: wordJlpt ?? undefined,
      irregularReading: irregularReading ?? undefined,
    });
  }
  return map;
}

function withMatchModes(
  matchModes: Partial<ReaderFuriganaSettings["matchModes"]>,
): ReaderFuriganaSettings {
  return {
    levels: defaultReaderFuriganaSettings.levels,
    matchModes: {
      ...defaultReaderFuriganaSettings.matchModes,
      matchAnyKanji: false,
      matchAllKanji: false,
      matchWordLevel: false,
      matchIrregularReading: false,
      ...matchModes,
    },
  };
}

describe("reader furigana match modes", () => {
  it("matchAnyKanji shows the whole word when any kanji matches", () => {
    const n3Only: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["省"]),
      enabledLevels: new Set([3]),
    };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(html, map, n3Only, withMatchModes({ matchAnyKanji: true }));
    expect(result).toContain("<ruby>反省会<rt>はんせいかい</rt></ruby>");
  });

  it("matchAllKanji requires every kanji in the word to match", () => {
    const partialSet: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["省"]),
      enabledLevels: new Set([3]),
    };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      partialSet,
      withMatchModes({ matchAllKanji: true }),
    );
    expect(result).not.toContain("<ruby>");
  });

  it("matchAllKanji shows when every kanji in the word matches", () => {
    const fullSet: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["反", "省", "会"]),
      enabledLevels: new Set([3]),
    };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(html, map, fullSet, withMatchModes({ matchAllKanji: true }));
    expect(result).toContain("<ruby>反省会<rt>はんせいかい</rt></ruby>");
  });

  it("matchWordLevel shows words whose JLPT level is selected even when kanji do not match", () => {
    const n4Only: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["昨"]),
      enabledLevels: new Set([4]),
    };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(html, map, n4Only, withMatchModes({ matchWordLevel: true }));
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("matchIrregularReading shows irregular readings when the word level matches", () => {
    const n4Only: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["昨"]),
      enabledLevels: new Set([4]),
    };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4, true]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n4Only,
      withMatchModes({ matchIrregularReading: true }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("does not show irregular readings when the word level is not selected", () => {
    const n4Only: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["昨"]),
      enabledLevels: new Set([4]),
    };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 5, true]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n4Only,
      withMatchModes({ matchIrregularReading: true }),
    );
    expect(result).not.toContain("<ruby>");
  });

  it("uses union semantics across enabled match modes", () => {
    const partialSet: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["省"]),
      enabledLevels: new Set([4]),
    };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      partialSet,
      withMatchModes({ matchAllKanji: true, matchWordLevel: true }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("shows nothing when no match modes are enabled", () => {
    const n3Only: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["省"]),
      enabledLevels: new Set([3]),
    };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(html, map, n3Only, withMatchModes({}));
    expect(result).not.toContain("<ruby>");
  });
});
