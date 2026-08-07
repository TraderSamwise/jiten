import { describe, expect, test } from "vitest";

import {
  getFillBlankHeadword,
  MIN_FILL_BLANK_WORDS,
  selectDistractorCandidates,
  toPlayableFillBlankEntries,
} from "./fill-blank-candidates";
import type { DictEntry } from "@/db/types";

interface EntryOptions {
  kanji?: string | null;
  kana?: string;
  pos?: string[];
  jlpt?: number | null;
  kanjiTags?: string[];
}

function entry(
  id: number,
  { kanji = null, kana = "かな", pos = ["n"], jlpt = null, kanjiTags = [] }: EntryOptions,
): DictEntry {
  return {
    id,
    common: true,
    jlptLevel: jlpt,
    kanji: kanji ? [{ text: kanji, common: true, tags: kanjiTags }] : [],
    kana: [{ text: kana, romaji: null, common: true, tags: [] }],
    senses: [{ partOfSpeech: pos, glosses: [{ lang: "eng", text: "gloss" }] }],
    pitchAccents: [],
  } as unknown as DictEntry;
}

/** Fixed generator so ranking is decided by score alone. */
const noJitter = () => 0;

describe("getFillBlankHeadword", () => {
  test("prefers the kanji form", () => {
    expect(getFillBlankHeadword(entry(1, { kanji: "食べる", kana: "たべる" }))).toBe("食べる");
  });

  test("falls back to kana — a kana-only word is playable here", () => {
    expect(getFillBlankHeadword(entry(2, { kana: "たくさん" }))).toBe("たくさん");
  });

  test("ignores search-only kanji forms", () => {
    const hidden = entry(3, { kanji: "本", kana: "ほん", kanjiTags: ["sK"] });
    expect(getFillBlankHeadword(hidden)).toBe("ほん");
  });

  test("keeps kana-only entries playable, unlike the reading game", () => {
    const entries = [entry(1, { kanji: "食べる" }), entry(2, { kana: "たくさん" })];
    expect(toPlayableFillBlankEntries(entries)).toHaveLength(2);
  });

  test("collapses entries sharing a headword — they can only fill one choice", () => {
    const entries = [
      entry(1, { kanji: "食べる", kana: "たべる" }),
      entry(2, { kanji: "食べる", kana: "たべる" }),
      entry(3, { kanji: "見る", kana: "みる" }),
    ];
    expect(toPlayableFillBlankEntries(entries).map((e) => e.id)).toEqual([1, 3]);
  });
});

describe("selectDistractorCandidates", () => {
  const target = entry(1, { kanji: "食べる", kana: "たべる", pos: ["v1"], jlpt: 5 });

  test("ranks a same-part-of-speech, same-level word above an unrelated one", () => {
    const related = entry(2, { kanji: "見る", kana: "みる", pos: ["v1"], jlpt: 5 });
    const unrelated = entry(3, { kanji: "経済", kana: "けいざい", pos: ["n"], jlpt: 2 });

    const picked = selectDistractorCandidates(target, [unrelated, related], {
      random: noJitter,
    });
    expect(picked.map((e) => e.id)).toEqual([2, 3]);
  });

  test("ranks a word sharing a kanji above one that does not", () => {
    const shares = entry(2, { kanji: "食事", kana: "しょくじ", pos: ["n"] });
    const plain = entry(3, { kanji: "会社", kana: "かいしゃ", pos: ["n"] });

    const picked = selectDistractorCandidates(target, [plain, shares], { random: noJitter });
    expect(picked[0].id).toBe(2);
  });

  test("never offers the target as its own distractor", () => {
    const picked = selectDistractorCandidates(target, [target, entry(2, { kanji: "見る" })], {
      random: noJitter,
    });
    expect(picked.map((e) => e.id)).toEqual([2]);
  });

  test("drops a homograph of the target, which could not be a distractor anyway", () => {
    const homograph = entry(9, { kanji: "食べる", kana: "たべる" });
    const other = entry(2, { kanji: "見る" });
    const picked = selectDistractorCandidates(target, [homograph, other], { random: noJitter });
    expect(picked.map((e) => e.id)).toEqual([2]);
  });

  test("does not treat two words with no part of speech as related", () => {
    const noPos = entry(1, { kanji: "食べる", pos: [] });
    // Nothing in common but a missing part of speech
    const alsoNoPos = entry(2, { kanji: "会社", kana: "かいしゃ", pos: [] });
    // Shares the 食 kanji, so genuinely the better distractor
    const sharesKanji = entry(3, { kanji: "食事", kana: "しょくじ", pos: ["n"] });

    const picked = selectDistractorCandidates(noPos, [alsoNoPos, sharesKanji], {
      random: noJitter,
    });
    // Scoring two absent parts of speech as a match would put 会社 first
    expect(picked.map((e) => e.id)).toEqual([3, 2]);
  });

  test("caps the pool at the limit", () => {
    const pool = Array.from({ length: 30 }, (_, i) => entry(i + 2, { kanji: `語${i}` }));
    expect(selectDistractorCandidates(target, pool, { limit: 10 })).toHaveLength(10);
  });

  test("returns nothing when there is no one to choose from", () => {
    expect(selectDistractorCandidates(target, [])).toEqual([]);
  });

  test("varies the order between rounds when scores tie", () => {
    const pool = Array.from({ length: 8 }, (_, i) => entry(i + 2, { kanji: `語${i}`, pos: ["n"] }));
    const first = selectDistractorCandidates(target, pool, { limit: 4 }).map((e) => e.id);
    const orders = new Set([first.join()]);
    for (let i = 0; i < 20; i++) {
      orders.add(
        selectDistractorCandidates(target, pool, { limit: 4 })
          .map((e) => e.id)
          .join(),
      );
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("round size floor", () => {
  test("at the minimum, every word still has three others to stand beside", () => {
    const entries = Array.from({ length: MIN_FILL_BLANK_WORDS }, (_, i) =>
      entry(i + 1, { kanji: `語${i}` }),
    );
    for (const target of entries) {
      expect(selectDistractorCandidates(target, entries).length).toBeGreaterThanOrEqual(3);
    }
  });

  test("one word short, and no word can be asked about", () => {
    const entries = Array.from({ length: MIN_FILL_BLANK_WORDS - 1 }, (_, i) =>
      entry(i + 1, { kanji: `語${i}` }),
    );
    for (const target of entries) {
      expect(selectDistractorCandidates(target, entries).length).toBeLessThan(3);
    }
  });
});
