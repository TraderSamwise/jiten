/**
 * A deinflection is only real if the entry it lands on can take it.
 *
 * `DeinflectCandidate.entryMask` says what the dictionary entry must be;
 * `posTagsToTypeMask` says what it is. The highlighter compares them, which is
 * how a page's する stops being read as an inflection of the noun 汁.
 */
import { describe, expect, it } from "vitest";

import { ANY_TYPE_MASK, deinflect, posTagsToTypeMask } from "./deinflect";

const admits = (surface: string, word: string, tags: string[]): boolean => {
  const entryMaskForWord = posTagsToTypeMask(tags);
  return deinflect(surface).some((candidate) => {
    if (candidate.word !== word || candidate.reasons.length === 0) return false;
    return candidate.entryMask === ANY_TYPE_MASK || (candidate.entryMask & entryMaskForWord) !== 0;
  });
};

describe("posTagsToTypeMask", () => {
  it("accepts every godan class by prefix, not by a list of spellings", () => {
    for (const tag of ["v5r", "v5k", "v5u", "v5s", "v5t", "v5n", "v5b", "v5m", "v5g"]) {
      expect(posTagsToTypeMask([tag])).toBeGreaterThan(0);
    }
    expect(posTagsToTypeMask(["v5r-i"])).toBe(posTagsToTypeMask(["v5r"]));
    expect(posTagsToTypeMask(["v5aru"])).toBe(posTagsToTypeMask(["v5r"]));
    expect(posTagsToTypeMask(["v5u-s"])).toBe(posTagsToTypeMask(["v5u"]));
  });

  it("gives a vs-c entry the godan bit too, since the す rules reach it", () => {
    expect(posTagsToTypeMask(["vs-c"]) & posTagsToTypeMask(["v5s"])).toBeGreaterThan(0);
  });

  it("leaves a noun with nothing", () => {
    expect(posTagsToTypeMask(["n", "n-suf", "adj-no"])).toBe(0);
    expect(posTagsToTypeMask(["pref"])).toBe(0);
  });

  it("does not constrain an expression with no word class of its own", () => {
    expect(posTagsToTypeMask(["exp"])).toBe(ANY_TYPE_MASK);
    // But a real class on the same entry wins: the tail is known.
    expect(posTagsToTypeMask(["exp", "v5r"])).toBe(posTagsToTypeMask(["v5r"]));
  });

  it("ignores the classical classes, which no rule produces", () => {
    expect(posTagsToTypeMask(["v2h-k"])).toBe(0);
    expect(posTagsToTypeMask(["v4r"])).toBe(0);
    expect(posTagsToTypeMask(["vz"])).toBe(0);
  });
});

describe("entryMask against a real part of speech", () => {
  it("refuses an ichidan inflection of a godan verb", () => {
    // はない is a legal ichidan negative, and 張る is godan — so it is not 張る.
    expect(admits("はない", "はる", ["v5r", "vt"])).toBe(false);
    expect(admits("はた", "はる", ["v5r", "vt"])).toBe(false);
  });

  it("refuses an inflection of a noun", () => {
    expect(admits("している", "しる", ["n", "n-suf"])).toBe(false);
    expect(admits("とい", "とう", ["n", "n-suf"])).toBe(false);
    expect(admits("だち", "だつ", ["pref"])).toBe(false);
  });

  it("keeps the inflections that are real", () => {
    expect(admits("励み", "励む", ["v5m", "vi"])).toBe(true);
    expect(admits("飽きない", "飽きる", ["v1", "vi"])).toBe(true);
    expect(admits("しめくくり", "しめくくる", ["v5r", "vt"])).toBe(true);
  });

  /**
   * Several rules reach one word from one surface, and the candidate list
   * keeps one entry per word — so the class has to be the union over all of
   * them, or whichever rule happens to be listed first decides the answer.
   */
  it("keeps a godan passive and conditional, which share a rule with ichidan", () => {
    // 叱られる is 叱ら + れる and 受け取れば is 受け取れ + ば; both strip onto the
    // godan dictionary form through a rule written for ichidan verbs.
    expect(admits("叱られる", "叱る", ["v5r", "vt"])).toBe(true);
    expect(admits("握られた", "握る", ["v5r", "vt"])).toBe(true);
    expect(admits("受け取れば", "受け取る", ["v5r", "vt"])).toBe(true);
    // And still keeps the ichidan reading of the same shape.
    expect(admits("食べられる", "食べる", ["v1", "vt"])).toBe(true);
  });

  it("keeps every written form of 来る and する, which the ichidan rules shadow", () => {
    for (const surface of [
      "来て",
      "来た",
      "来ない",
      "来なかった",
      "来ます",
      "来ました",
      "来れば",
      "来たら",
      "来られる",
      "来させる",
      "来よう",
      "来ている",
      "来てる",
    ]) {
      expect(admits(surface, "来る", ["vk", "vi"])).toBe(true);
    }
    // 来い is the exception: it is its own entry, so there is no rule for it.
    expect(admits("来い", "来る", ["vk", "vi"])).toBe(false);
    for (const surface of ["すれば", "される", "している"]) {
      expect(admits(surface, "する", ["vs-i", "vt", "vi"])).toBe(true);
    }
  });
});
