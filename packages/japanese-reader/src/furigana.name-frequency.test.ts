/**
 * Ranking name readings by how often a spelling is actually read that way.
 *
 * 杏子 is the case this exists for: JMnedict lists thirteen readings, scores
 * them identically, and the reader printed whichever row SQLite happened to
 * return first — あんず, the apricot. The counts break that tie.
 *
 * Two invariants matter more than the fix, and are pinned here because
 * breaking either is how this feature turns into wrong furigana everywhere:
 *
 *   - Counts rank readings of ONE spelling, never two spellings against each
 *     other. They are undercounts from a corpus covering half the spellings,
 *     so 高遠's 4 and 洋子's 267 say nothing about each other.
 *   - A count only overrides a common word when there is enough of it AND one
 *     reading really dominates. Otherwise two sightings of an obscure surname
 *     would write furigana over a common noun.
 */
import { describe, expect, it } from "vitest";
import {
  isExactRareForm,
  nameReadingDominance,
  pickBestNameMatch,
  type NameMatch,
} from "./furigana";
import {
  AUTO_NAME_ONLY_CONFIDENCE,
  computeAutoNameConfidence,
  isDominantNameReading,
  type AutoNameNameCandidate,
  type AutoNameWordCandidate,
} from "./auto-name";

const name = (kanjiForm: string, kanaForm: string, freq: number | null = null): NameMatch => ({
  kanjiForm,
  kanaForm,
  nameType: "fem",
  translation: null,
  freq,
});

/** 杏子 as JMnedict has it, with the counts the derivation found. */
const anzuko = (): NameMatch[] => [
  name("杏子", "あこ", 1),
  name("杏子", "あん"),
  name("杏子", "あんこ"),
  name("杏子", "あんず", 2),
  name("杏子", "あんずこ"),
  name("杏子", "きょうこ", 25),
  name("杏子", "きょうし", 1),
  name("杏子", "きようこ"),
  name("杏子", "ちょうこ"),
  name("杏子", "なつこ"),
  name("杏子", "ももこ", 1),
  name("杏子", "ようこ"),
  name("杏子", "りょうこ"),
];

describe("pickBestNameMatch", () => {
  it("picks the reading people actually use, not the first row", () => {
    expect(pickBestNameMatch("杏子", anzuko())?.kanaForm).toBe("きょうこ");
  });

  it("still picks it when the counted reading is listed last", () => {
    const reversed = [...anzuko()].reverse();
    expect(pickBestNameMatch("杏子", reversed)?.kanaForm).toBe("きょうこ");
  });

  it("keeps SQLite's order when nothing was counted", () => {
    const uncounted = anzuko().map((match) => ({ ...match, freq: null }));
    expect(pickBestNameMatch("杏子", uncounted)?.kanaForm).toBe("あこ");
  });

  it("never lets one spelling's count outrank another spelling", () => {
    // 陽子 and 洋子 both read ようこ, so both match this surface and score
    // identically — the exact case where the tiebreak could fire across
    // spellings. It must not: the counts are undercounts from a corpus that
    // covers half the spellings, so 267 against 120 is not a comparison, and
    // whichever row came first stays.
    const across = [name("陽子", "ようこ", 120), name("洋子", "ようこ", 267)];
    expect(pickBestNameMatch("ようこ", across)?.kanjiForm).toBe("陽子");
    expect(pickBestNameMatch("ようこ", [...across].reverse())?.kanjiForm).toBe("洋子");
  });

  it("prefers a higher-scoring reading over a better-counted one", () => {
    // Frequency orders equals; it does not overrule the score. A translated
    // entry scores +25, which outweighs any count.
    const matches = [
      name("杏子", "きょうこ", 25),
      { ...name("杏子", "ももこ", 1), translation: "Momoko" },
    ];
    expect(pickBestNameMatch("杏子", matches)?.kanaForm).toBe("ももこ");
  });
});

describe("isExactRareForm", () => {
  const word = (common: boolean, commonForm: boolean, kanjiForm: string) => ({
    common,
    commonForm,
    kanjiForm,
  });

  it("holds for a rare spelling of a common word", () => {
    // 杏子 belongs to the common entry for あんず, written 杏.
    expect(isExactRareForm(word(true, false, "杏子"), "杏子")).toBe(true);
  });

  it("does not hold when the spelling is the common one", () => {
    expect(isExactRareForm(word(true, true, "希望"), "希望")).toBe(false);
  });

  it("does not hold for a word that is not common at all", () => {
    // This is the one that matters. A word JMdict marks common nowhere has no
    // common form to be a rare variant of, so without the `common` test this
    // reduces to "not a common word" and discounts every exact match — which
    // read 和音 as かずね, 一矢 as かずや and 古池 as こいけ.
    expect(isExactRareForm(word(false, false, "和音"), "和音")).toBe(false);
  });

  it("does not hold when the surface is not the matched spelling", () => {
    expect(isExactRareForm(word(true, false, "杏"), "杏子")).toBe(false);
  });
});

describe("nameReadingDominance", () => {
  it("measures the winner's share of its own spelling", () => {
    const matches = anzuko();
    const best = pickBestNameMatch("杏子", matches)!;
    expect(nameReadingDominance(best, matches)).toEqual({ share: 25 / 30, total: 30 });
  });

  it("is null when nothing was counted", () => {
    const matches = anzuko().map((match) => ({ ...match, freq: null }));
    expect(nameReadingDominance(matches[0], matches)).toBeNull();
  });

  it("counts only the spelling's own readings towards the total", () => {
    const matches = [name("高遠", "たかとお", 4), name("洋子", "ようこ", 267)];
    expect(nameReadingDominance(matches[0], matches)).toEqual({ share: 1, total: 4 });
  });
});

describe("isDominantNameReading", () => {
  it("accepts a settled reading", () => {
    expect(isDominantNameReading({ share: 25 / 30, total: 30 })).toBe(true);
  });

  it("refuses a bare plurality", () => {
    expect(isDominantNameReading({ share: 0.5, total: 40 })).toBe(false);
  });

  it("refuses too little evidence however lopsided", () => {
    expect(isDominantNameReading({ share: 1, total: 3 })).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isDominantNameReading(null)).toBe(false);
    expect(isDominantNameReading(undefined)).toBe(false);
  });
});

describe("computeAutoNameConfidence with a settled reading", () => {
  /** 杏子: a common entry for あんず, whose common spelling is 杏, not 杏子. */
  const rarelySpelledWord: AutoNameWordCandidate = {
    matchedText: "杏子",
    exactSurface: true,
    exactCommonWord: true,
    commonWord: true,
    deinflected: false,
    exactRareForm: true,
  };
  /** 希望: a common entry whose common spelling IS 希望. */
  const commonlySpelledWord: AutoNameWordCandidate = {
    ...rarelySpelledWord,
    matchedText: "希望",
    exactRareForm: false,
  };
  const candidate = (dominance: AutoNameNameCandidate["dominance"]): AutoNameNameCandidate => ({
    matchedText: "杏子",
    exactSurface: true,
    candidateCount: 13,
    nameType: "fem",
    hasTranslation: true,
    dominance,
  });

  it("lets a settled name beat a word that is rarely spelled this way", () => {
    expect(
      computeAutoNameConfidence(candidate({ share: 26 / 33, total: 33 }), rarelySpelledWord),
    ).toBeGreaterThanOrEqual(AUTO_NAME_ONLY_CONFIDENCE);
  });

  it("never beats a word whose common spelling IS this one", () => {
    // 希望 is のぞみ to a great many people and きぼう on the page. The counts
    // say which reading a name takes, never that a name is what is written.
    expect(
      computeAutoNameConfidence(
        { ...candidate({ share: 1, total: 500 }), matchedText: "希望" },
        commonlySpelledWord,
      ),
    ).toBeLessThan(AUTO_NAME_ONLY_CONFIDENCE);
  });

  it("leaves the word winning when nothing was counted", () => {
    // The thirteen readings are still thirteen reasons to doubt.
    expect(computeAutoNameConfidence(candidate(null), rarelySpelledWord)).toBeLessThan(
      AUTO_NAME_ONLY_CONFIDENCE,
    );
  });

  it("does not hand a rare spelling to an unattested name", () => {
    // 真面 is a rare spelling of まとも, and さなつら is a surname with one
    // listing and no sightings. A rare spelling on its own must not reopen
    // the question — only evidence that the spelling names people does.
    const manukeNoEvidence: AutoNameNameCandidate = {
      matchedText: "真面",
      exactSurface: true,
      candidateCount: 1,
      nameType: "surname",
      hasTranslation: true,
      dominance: null,
    };
    const matomo: AutoNameWordCandidate = {
      matchedText: "真面",
      exactSurface: true,
      exactCommonWord: true,
      commonWord: true,
      deinflected: false,
      exactRareForm: true,
    };
    expect(computeAutoNameConfidence(manukeNoEvidence, matomo)).toBeLessThan(
      AUTO_NAME_ONLY_CONFIDENCE,
    );
  });

  it("leaves the word winning on too few observations", () => {
    expect(
      computeAutoNameConfidence(candidate({ share: 1, total: 3 }), rarelySpelledWord),
    ).toBeLessThan(AUTO_NAME_ONLY_CONFIDENCE);
  });

  it("leaves the word winning when the readings are split", () => {
    expect(
      computeAutoNameConfidence(candidate({ share: 0.5, total: 60 }), rarelySpelledWord),
    ).toBeLessThan(AUTO_NAME_ONLY_CONFIDENCE);
  });

  it("changes nothing for a spelling that is not also a word", () => {
    const noWord: AutoNameWordCandidate = {
      matchedText: "高遠",
      exactSurface: false,
      exactCommonWord: false,
      commonWord: false,
      deinflected: false,
    };
    const takatoo: AutoNameNameCandidate = {
      matchedText: "高遠",
      exactSurface: true,
      candidateCount: 4,
      nameType: "surname",
      hasTranslation: true,
      dominance: { share: 1, total: 4 },
    };
    // total 4 is below the floor, so this is the untouched path.
    expect(computeAutoNameConfidence(takatoo, noWord)).toBe(
      computeAutoNameConfidence({ ...takatoo, dominance: null }, noWord),
    );
  });
});
