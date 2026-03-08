import { describe, it, expect } from "vitest";
import {
  applyFuriganaToHtml,
  injectRubySpacers,
  extractSurfacesFromHtml,
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
  entries: [string, string, string, number | null][],
): Map<string, FuriganaEntry> {
  const map = new Map<string, FuriganaEntry>();
  for (const [surface, kanjiPart, reading, wordJlpt] of entries) {
    map.set(surface, {
      kanjiPart,
      reading,
      kanjiPartLen: [...kanjiPart].length,
      wordJlpt: wordJlpt ?? undefined,
    });
  }
  return map;
}

describe("word-level JLPT filtering", () => {
  // Scenario: user enables N4 level (meaning "show furigana for N4-level content").
  // enabledLevels = new Set([4])
  //
  // JLPT scale: 5=easiest, 1=hardest.
  // "Enabled N4" means: show furigana for words at difficulty level 4.
  // Words easier than the enabled level (jlpt > max enabled) should be suppressed.

  // ── Category A: Easy kanji, hard/unusual reading ──
  // All kanji are N5 (easy) but the word itself is harder (N4 or below).
  // Current kanji-level filter MISSES these because no kanji matches N4.
  // Word-level filter should SHOW furigana because word JLPT matches.

  describe("Category A: easy kanji, hard reading (should show furigana)", () => {
    // User enables N4. These words are word_jlpt=4. Kanji are all N5.
    // Kanji-level filter alone would miss them. Word-level filter should catch them.
    const n4Kanji: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["昨"]), // only N4 kanji in the set — 左右上下 are N5, not in set
    };

    it("左右 (さゆう) — N5 kanji, N4 word", () => {
      const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4]]);
      const html = "<p>左右を見る</p>";
      const result = applyFuriganaToHtml(html, map, n4Kanji);
      expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
    });

    it("上手 (じょうず) — N5 kanji, N4 word", () => {
      const map = makeMapWithJlpt([["上手", "上手", "じょうず", 4]]);
      const html = "<p>上手になる</p>";
      const result = applyFuriganaToHtml(html, map, n4Kanji);
      expect(result).toContain("<ruby>上手<rt>じょうず</rt></ruby>");
    });

    it("下手 (へた) — N5 kanji, N4 word", () => {
      const map = makeMapWithJlpt([["下手", "下手", "へた", 4]]);
      const html = "<p>下手だ</p>";
      const result = applyFuriganaToHtml(html, map, n4Kanji);
      expect(result).toContain("<ruby>下手<rt>へた</rt></ruby>");
    });

    // Harder words (N3, N2, N1) — should also show when their level is enabled
    it("今朝 (けさ) — N5 kanji, N3 word", () => {
      const n3Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["今朝", "今朝", "けさ", 3]]);
      const html = "<p>今朝は寒い</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).toContain("<ruby>今朝<rt>けさ</rt></ruby>");
    });

    it("田舎 (いなか) — N5 kanji, N3 word", () => {
      const n3Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["田舎", "田舎", "いなか", 3]]);
      const html = "<p>田舎に帰る</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).toContain("<ruby>田舎<rt>いなか</rt></ruby>");
    });

    it("土産 (みやげ) — N5 kanji, N2 word", () => {
      const n2Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["土産", "土産", "みやげ", 2]]);
      const html = "<p>土産を買う</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).toContain("<ruby>土産<rt>みやげ</rt></ruby>");
    });

    it("大和 (やまと) — N5 kanji, N2 word", () => {
      const n2Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["大和", "大和", "やまと", 2]]);
      const html = "<p>大和の国</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).toContain("<ruby>大和<rt>やまと</rt></ruby>");
    });

    it("海老 (えび) — N5 kanji, N2 word", () => {
      const n2Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["海老", "海老", "えび", 2]]);
      const html = "<p>海老を食べる</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).toContain("<ruby>海老<rt>えび</rt></ruby>");
    });

    it("七夕 (たなばた) — N5 kanji, N1 word", () => {
      const n1Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["七夕", "七夕", "たなばた", 1]]);
      const html = "<p>七夕の夜</p>";
      const result = applyFuriganaToHtml(html, map, n1Kanji);
      expect(result).toContain("<ruby>七夕<rt>たなばた</rt></ruby>");
    });

    it("仲人 (なこうど) — N5 kanji, N1 word", () => {
      const n1Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };
      const map = makeMapWithJlpt([["仲人", "仲人", "なこうど", 1]]);
      const html = "<p>仲人を頼む</p>";
      const result = applyFuriganaToHtml(html, map, n1Kanji);
      expect(result).toContain("<ruby>仲人<rt>なこうど</rt></ruby>");
    });
  });

  // ── Category B: Hard kanji, easy word ──
  // The kanji are rated at a harder level but the word itself is easy (everyone knows it).
  // Word-level filter should SUPPRESS furigana because word JLPT is easier than enabled level.
  // Uses mock data: pretend 綺=N2, 麗=N2 but 綺麗 word=N5.

  describe("Category B: hard kanji, easy word (should suppress furigana)", () => {
    // User enables N2. These words have N2 kanji but are N5 vocabulary.
    // Kanji-level filter would show furigana (kanji matches N2).
    // Word-level filter should suppress it (word is N5, easier than N2).
    // NOTE: In the current DB, most of these kanji are actually rated N5 (not N2),
    // so this category doesn't manifest with real data yet. These mock values
    // (pretending kanji are N2) test the algorithm for when we rederive JLPT data
    // with more accurate kanji difficulty levels.
    const n2Kanji: FuriganaKanjiSet = {
      all: false,
      chars: new Set(["綺", "麗", "挨", "拶", "頑", "沢", "慢", "昨", "果"]),
    };

    it("綺麗 (きれい) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["綺麗", "綺麗", "きれい", 5]]);
      const html = "<p>綺麗な花</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("挨拶 (あいさつ) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["挨拶", "挨拶", "あいさつ", 5]]);
      const html = "<p>挨拶する</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("頑張る (がんばる) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["頑張", "頑張", "がんば", 5]]);
      const html = "<p>頑張る</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("沢山 (たくさん) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["沢山", "沢山", "たくさん", 5]]);
      const html = "<p>沢山ある</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("我慢 (がまん) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["我慢", "我慢", "がまん", 5]]);
      const html = "<p>我慢する</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("昨日 (きのう) — N2 kanji, N4 word → no furigana at N2", () => {
      const map = makeMapWithJlpt([["昨日", "昨日", "きのう", 4]]);
      const html = "<p>昨日の事</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("果物 (くだもの) — N2 kanji, N5 word → no furigana", () => {
      const map = makeMapWithJlpt([["果物", "果物", "くだもの", 5]]);
      const html = "<p>果物を食べる</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).not.toContain("<ruby>");
    });

    // But if the word JLPT matches or is harder than the enabled level, show it
    it("hard kanji + hard word → shows furigana", () => {
      const map = makeMapWithJlpt([["挫折", "挫折", "ざせつ", 2]]);
      const n2WithExtra: FuriganaKanjiSet = {
        all: false,
        chars: new Set([...n2Kanji.chars, "挫", "折"]),
      };
      const html = "<p>挫折した</p>";
      const result = applyFuriganaToHtml(html, map, n2WithExtra);
      expect(result).toContain("<ruby>挫折<rt>ざせつ</rt></ruby>");
    });

    // Word with no JLPT data falls back to kanji-level filter (existing behavior)
    it("no word JLPT → falls back to kanji-level filter", () => {
      const map = makeMapWithJlpt([["綺麗", "綺麗", "きれい", null]]);
      const html = "<p>綺麗な花</p>";
      const result = applyFuriganaToHtml(html, map, n2Kanji);
      expect(result).toContain("<ruby>綺麗<rt>きれい</rt></ruby>");
    });
  });

  // ── Category C: Easy kanji, standard reading, hard word ──
  // All kanji are N5, readings are standard on/kun, word is harder.
  // Current kanji-level filter correctly skips these (no kanji matches the harder level).
  // Word-level filter should also NOT show furigana — the reading is deducible from kanji.
  // The word is "hard" vocabulary but you can READ it; furigana wouldn't help.

  describe("Category C: easy kanji, standard reading, hard word (no furigana needed)", () => {
    // User enables N3. These words are word_jlpt=3 but kanji are N5.
    // Neither kanji-level nor word-level filter should show furigana.
    // The reading is standard — user can sound it out from the kanji.
    const n3Kanji: FuriganaKanjiSet = { all: false, chars: new Set() };

    it("世話 (せわ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["世話", "世話", "せわ", 3]]);
      const html = "<p>世話になる</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("手前 (てまえ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["手前", "手前", "てまえ", 3]]);
      const html = "<p>手前の方</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("見物 (けんぶつ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["見物", "見物", "けんぶつ", 3]]);
      const html = "<p>見物する</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("読書 (どくしょ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["読書", "読書", "どくしょ", 3]]);
      const html = "<p>読書が好き</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("年上 (としうえ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["年上", "年上", "としうえ", 3]]);
      const html = "<p>年上の人</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("外出 (がいしゅつ) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["外出", "外出", "がいしゅつ", 3]]);
      const html = "<p>外出する</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("長男 (ちょうなん) — N5 kanji, standard reading, N3 word → no furigana", () => {
      const map = makeMapWithJlpt([["長男", "長男", "ちょうなん", 3]]);
      const html = "<p>長男が生まれた</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("人前 (ひとまえ) — N5 kanji, standard reading, N2 word → no furigana", () => {
      const map = makeMapWithJlpt([["人前", "人前", "ひとまえ", 2]]);
      const html = "<p>人前で話す</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("名人 (めいじん) — N5 kanji, standard reading, N2 word → no furigana", () => {
      const map = makeMapWithJlpt([["名人", "名人", "めいじん", 2]]);
      const html = "<p>将棋の名人</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });

    it("大小 (だいしょう) — N5 kanji, standard reading, N2 word → no furigana", () => {
      const map = makeMapWithJlpt([["大小", "大小", "だいしょう", 2]]);
      const html = "<p>大小の問題</p>";
      const result = applyFuriganaToHtml(html, map, n3Kanji);
      expect(result).not.toContain("<ruby>");
    });
  });
});
