import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  applyFuriganaToHtml,
  defaultReaderFuriganaSettings,
  injectRubySpacers,
  extractSurfacesFromHtml,
  resolveFuriganaBatch,
  type FuriganaEntry,
  type FuriganaKanjiSet,
  type ReaderFuriganaSettings,
} from "./reader-furigana";

const allKanji: FuriganaKanjiSet = { all: true, chars: new Set() };
const DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary.db");
const EXT_DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary-extended.db");

function wrapBetterSqlite(db: Database.Database): SQLiteDatabase {
  return {
    getAllAsync: async <T>(sql: string, params?: unknown[]) => {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]) => {
      const stmt = db.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | null;
    },
  } as unknown as SQLiteDatabase;
}

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

function withRuleLevels(
  ruleLevels: Partial<ReaderFuriganaSettings["ruleLevels"]>,
): ReaderFuriganaSettings {
  return {
    sourceDefault: defaultReaderFuriganaSettings.sourceDefault,
    ruleLevels: {
      matchAnyKanji: { n5: false, n4: false, n3: false, n2: false, n1: false, nonJouyou: false },
      matchWordLevel: { n5: false, n4: false, n3: false, n2: false, n1: false, nonJouyou: false },
      matchIrregularReading: {
        n5: false,
        n4: false,
        n3: false,
        n2: false,
        n1: false,
        nonJouyou: false,
      },
      matchMostlyKunyomi: {
        n5: false,
        n4: false,
        n3: false,
        n2: false,
        n1: false,
        nonJouyou: false,
      },
      matchMostlyOnyomi: {
        n5: false,
        n4: false,
        n3: false,
        n2: false,
        n1: false,
        nonJouyou: false,
      },
      matchMixedOnKun: {
        n5: false,
        n4: false,
        n3: false,
        n2: false,
        n1: false,
        nonJouyou: false,
      },
      ...ruleLevels,
    },
  };
}

describe("reader furigana rule levels", () => {
  it("matchAnyKanji shows the whole word when any kanji matches", () => {
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n3Only,
      withRuleLevels({
        matchAnyKanji: { n5: false, n4: false, n3: true, n2: false, n1: false, nonJouyou: false },
      }),
    );
    expect(result).toContain("<ruby>反省会<rt>はんせいかい</rt></ruby>");
  });

  it("matchWordLevel shows words whose JLPT level is selected even when kanji do not match", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n4Only,
      withRuleLevels({
        matchWordLevel: { n5: false, n4: true, n3: false, n2: false, n1: false, nonJouyou: false },
      }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("matchIrregularReading shows irregular readings when the word level matches", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4, true]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n4Only,
      withRuleLevels({
        matchIrregularReading: {
          n5: false,
          n4: true,
          n3: false,
          n2: false,
          n1: false,
          nonJouyou: false,
        },
      }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("does not show irregular readings when the word level is not selected", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 5, true]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      n4Only,
      withRuleLevels({
        matchIrregularReading: {
          n5: false,
          n4: true,
          n3: false,
          n2: false,
          n1: false,
          nonJouyou: false,
        },
      }),
    );
    expect(result).not.toContain("<ruby>");
  });

  it("matchMostlyKunyomi shows kunyomi words when the word level matches", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = new Map<string, FuriganaEntry>([
      [
        "食べる",
        {
          kanjiPart: "食",
          reading: "た",
          kanjiPartLen: 1,
          wordJlpt: 4,
          readingPattern: "mostly_kunyomi",
        },
      ],
    ]);
    const result = applyFuriganaToHtml(
      "<p>食べる</p>",
      map,
      n4Only,
      withRuleLevels({
        matchMostlyKunyomi: {
          n5: false,
          n4: true,
          n3: false,
          n2: false,
          n1: false,
          nonJouyou: false,
        },
      }),
    );
    expect(result).toContain("<ruby>食<rt>た</rt></ruby>べる");
  });

  it("matchMostlyOnyomi shows onyomi compounds when the word level matches", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = new Map<string, FuriganaEntry>([
      [
        "学校",
        {
          kanjiPart: "学校",
          reading: "がっこう",
          kanjiPartLen: 2,
          wordJlpt: 4,
          readingPattern: "mostly_onyomi",
        },
      ],
    ]);
    const result = applyFuriganaToHtml(
      "<p>学校</p>",
      map,
      n4Only,
      withRuleLevels({
        matchMostlyOnyomi: {
          n5: false,
          n4: true,
          n3: false,
          n2: false,
          n1: false,
          nonJouyou: false,
        },
      }),
    );
    expect(result).toContain("<ruby>学校<rt>がっこう</rt></ruby>");
  });

  it("matchMixedOnKun shows mixed compounds when the word level matches", () => {
    const n4Only: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = new Map<string, FuriganaEntry>([
      [
        "重箱",
        {
          kanjiPart: "重箱",
          reading: "じゅうばこ",
          kanjiPartLen: 2,
          wordJlpt: 4,
          readingPattern: "mixed_on_kun",
        },
      ],
    ]);
    const result = applyFuriganaToHtml(
      "<p>重箱</p>",
      map,
      n4Only,
      withRuleLevels({
        matchMixedOnKun: {
          n5: false,
          n4: true,
          n3: false,
          n2: false,
          n1: false,
          nonJouyou: false,
        },
      }),
    );
    expect(result).toContain("<ruby>重箱<rt>じゅうばこ</rt></ruby>");
  });

  it("uses union semantics across rule-specific level filters", () => {
    const partialSet: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 4]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      partialSet,
      withRuleLevels({
        matchAnyKanji: { n5: false, n4: false, n3: true, n2: false, n1: false, nonJouyou: false },
        matchWordLevel: { n5: false, n4: true, n3: false, n2: false, n1: false, nonJouyou: false },
      }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("shows a word when any-kanji and word-level use different level sets", () => {
    const partialSet: FuriganaKanjiSet = { all: false, chars: new Set(["昨"]) };
    const map = makeMapWithJlpt([["左右", "左右", "さゆう", 1]]);
    const html = "<p>左右を見る</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      partialSet,
      withRuleLevels({
        matchAnyKanji: { n5: false, n4: false, n3: true, n2: true, n1: false, nonJouyou: false },
        matchWordLevel: { n5: false, n4: false, n3: false, n2: false, n1: true, nonJouyou: false },
      }),
    );
    expect(result).toContain("<ruby>左右<rt>さゆう</rt></ruby>");
  });

  it("shows nothing when no rule levels are enabled", () => {
    const n3Only: FuriganaKanjiSet = { all: false, chars: new Set(["省"]) };
    const map = makeMapWithJlpt([["反省会", "反省会", "はんせいかい", 3]]);
    const html = "<p>反省会をする</p>";
    const result = applyFuriganaToHtml(html, map, n3Only, withRuleLevels({}));
    expect(result).not.toContain("<ruby>");
  });

  it("does not show an embedded subword when the whole containing word fails the filter", () => {
    const noKanjiMatches: FuriganaKanjiSet = { all: false, chars: new Set() };
    const map = new Map<string, FuriganaEntry>([
      [
        "居心地",
        {
          kanjiPart: "居心地",
          reading: "いごこち",
          kanjiPartLen: 3,
          wordJlpt: 3,
        },
      ],
      [
        "心地",
        {
          kanjiPart: "心地",
          reading: "ここち",
          kanjiPartLen: 2,
          wordJlpt: 1,
        },
      ],
    ]);
    const html = "<p>居心地の悪さ</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      noKanjiMatches,
      withRuleLevels({
        matchWordLevel: { n5: false, n4: false, n3: false, n2: false, n1: true, nonJouyou: false },
      }),
    );
    expect(result).not.toContain("<ruby>");
  });

  it("does not show a leading kanji subword when the full compound fails the filter", () => {
    const noKanjiMatches: FuriganaKanjiSet = { all: false, chars: new Set() };
    const map = new Map<string, FuriganaEntry>([
      [
        "場所",
        {
          kanjiPart: "場所",
          reading: "ばしょ",
          kanjiPartLen: 2,
          wordJlpt: 4,
        },
      ],
      [
        "場",
        {
          kanjiPart: "場",
          reading: "ば",
          kanjiPartLen: 1,
          wordJlpt: 3,
        },
      ],
    ]);
    const html = "<p>場所のない</p>";
    const result = applyFuriganaToHtml(
      html,
      map,
      noKanjiMatches,
      withRuleLevels({
        matchWordLevel: { n5: false, n4: false, n3: true, n2: false, n1: false, nonJouyou: false },
      }),
    );
    expect(result).not.toContain("<ruby>");
  });
});

describe("resolveFuriganaBatch compound resolution", () => {
  let rawDb: Database.Database;
  let dictDb: SQLiteDatabase;
  let rawExtDb: Database.Database;
  let extDb: SQLiteDatabase;

  beforeAll(() => {
    rawDb = new Database(DB_PATH, { readonly: true });
    dictDb = wrapBetterSqlite(rawDb);
    rawExtDb = new Database(EXT_DB_PATH, { readonly: true });
    extDb = wrapBetterSqlite(rawExtDb);
  });

  afterAll(() => {
    rawDb.close();
    rawExtDb.close();
  });

  it("resolves 一軒 as いっけん, not 軒=のき", async () => {
    const result = await resolveFuriganaBatch(["一軒"], dictDb, extDb);
    expect(result["一軒"]?.reading).toBe("いっけん");
    expect(result["一軒"]?.fullKanjiForm).toBe("一軒");
  });

  it("resolves 乾杯 as かんぱい, not 杯=さかずき/はい", async () => {
    const result = await resolveFuriganaBatch(["乾杯"], dictDb);
    expect(result["乾杯"]?.reading).toBe("かんぱい");
    expect(result["乾杯"]?.fullKanjiForm).toBe("乾杯");
  });

  it("resolves 絶品 as ぜっぴん, not 品=しな", async () => {
    const result = await resolveFuriganaBatch(["絶品"], dictDb);
    expect(result["絶品"]?.reading).toBe("ぜっぴん");
    expect(result["絶品"]?.fullKanjiForm).toBe("絶品");
  });

  it("resolves 持ち主 as もちぬし as a whole word", async () => {
    const result = await resolveFuriganaBatch(["持ち主"], dictDb);
    expect(result["持ち主"]?.reading).toBe("もちぬし");
    expect(result["持ち主"]?.fullKanjiForm).toBe("持ち主");
  });

  it("resolves 大勢 as おおぜい, not 勢=いきおい", async () => {
    const result = await resolveFuriganaBatch(["大勢"], dictDb);
    expect(result["大勢"]?.reading).toBe("おおぜい");
    expect(result["大勢"]?.fullKanjiForm).toBe("大勢");
  });

  it("full pipeline keeps 一軒 as one ruby match, not 軒", async () => {
    const html = "<p>三軒横に並んだ海の家を見やる。</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb, extDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(html, fMap, allKanji);
    expect(result).toContain("<ruby>三軒<rt>さんけん</rt></ruby>");
    expect(result).not.toContain("<ruby>軒<rt>のき</rt></ruby>");
  });

  it("full pipeline keeps 絶品 as one ruby match, not 品", async () => {
    const html = "<p>絶品の干物も宿泊無料。</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(html, fMap, allKanji);
    expect(result).toContain("<ruby>絶品<rt>ぜっぴん</rt></ruby>");
    expect(result).not.toContain("<ruby>品<rt>しな</rt></ruby>");
  });

  it("full pipeline keeps 持ち主 as one ruby match, not 主", async () => {
    const html = "<p>別荘の持ち主も誘う。</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(html, fMap, allKanji);
    expect(result).toContain("<ruby>持ち主<rt>もちぬし</rt></ruby>");
    expect(result).not.toContain("<ruby>主<rt>");
  });

  it("full pipeline keeps 大勢 as おおぜい, not 勢=いきおい", async () => {
    const html = "<p>そしたら大勢でたいへん。</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(html, fMap, allKanji);
    expect(result).toContain("<ruby>大勢<rt>おおぜい</rt></ruby>");
    expect(result).not.toContain("<ruby>勢<rt>いきおい</rt></ruby>");
  });

  it("full pipeline does not leak 心地 furigana into 居心地 when only N1 word-level is enabled", async () => {
    const html = "<p>居心地の悪さ</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(
      html,
      fMap,
      { all: false, chars: new Set() },
      withRuleLevels({
        matchWordLevel: { n5: false, n4: false, n3: false, n2: false, n1: true, nonJouyou: false },
      }),
    );
    expect(result).not.toContain("<ruby>");
  });

  it("full pipeline does not leak 場 furigana into 場所 when only N3 word-level is enabled", async () => {
    const html = "<p>場所のない</p>";
    const surfaces = extractSurfacesFromHtml(html, allKanji);
    const readings = await resolveFuriganaBatch(surfaces, dictDb);
    const fMap = new Map<string, FuriganaEntry>(Object.entries(readings));
    const result = applyFuriganaToHtml(
      html,
      fMap,
      { all: false, chars: new Set() },
      withRuleLevels({
        matchWordLevel: { n5: false, n4: false, n3: true, n2: false, n1: false, nonJouyou: false },
      }),
    );
    expect(result).not.toContain("<ruby>");
  });
});
