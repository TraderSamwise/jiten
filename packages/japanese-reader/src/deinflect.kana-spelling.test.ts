import { describe, expect, it } from "vitest";
import { kanaSpellings as spell } from "./deinflect";

const kanaSpellings = (text: string, readings: readonly string[]) =>
  spell(text, readings).spellings;

// 持つ's KANJIDIC kun readings, dots and all, plus 気's.
const MOTSU = ["も.つ", "-も.ち", "も.てる"];
const KI = ["いき", "き"];

describe("kanaSpellings", () => {
  it("rewrites the one kanji as its reading", () => {
    // 気を持たせる is written 気をもたせる in the wild; きをもたせる is the entry's
    // own kana form, so rewriting the last kanji reaches it.
    expect(kanaSpellings("気をもたせる", KI)).toContain("きをもたせる");
  });

  /**
   * KANJIDIC marks okurigana with a dot: 持 is "も.つ", where only も is the
   * kanji's own reading and つ is the trailing kana. Keeping the whole string
   * would spell もつをもたせる and lose the reading that matters.
   */
  it("keeps only the part of a reading before the okurigana dot", () => {
    expect(kanaSpellings("持たせる", MOTSU)).toContain("もたせる");
    expect(kanaSpellings("持たせる", MOTSU)).not.toContain("もつたせる");
  });

  it("ignores the leading hyphen on a suffix reading", () => {
    expect(kanaSpellings("持たせる", ["-も.ち"])).toContain("もたせる");
  });

  it("folds katakana on readings to hiragana", () => {
    expect(kanaSpellings("気をもたせる", ["キ"])).toContain("きをもたせる");
  });

  it("returns nothing unless exactly one kanji is present", () => {
    expect(kanaSpellings("もたせる", KI)).toEqual([]);
    expect(kanaSpellings("気を持たせる", KI)).toEqual([]);
  });

  /**
   * A two-character substring rewritten as kana lands on far too much: 気が
   * becomes きが, which is the common word 飢餓.
   */
  it("returns nothing for a substring too short to be a phrase", () => {
    expect(kanaSpellings("気が", KI)).toEqual([]);
    expect(kanaSpellings("気", KI)).toEqual([]);
  });

  it("does not repeat itself or return the input unchanged", () => {
    const out = kanaSpellings("気をもたせる", ["き", "き", "キ"]);
    expect(out).toEqual([...new Set(out)]);
    expect(out).not.toContain("気をもたせる");
  });

  it("caps how many spellings one kanji may produce", () => {
    const many = Array.from({ length: 30 }, (_, i) => `か${i}`);
    expect(kanaSpellings("気をもたせる", many).length).toBeLessThanOrEqual(8);
  });

  it("returns nothing when the kanji has no readings", () => {
    expect(kanaSpellings("気をもたせる", [])).toEqual([]);
  });

  it("strips a trailing hyphen from a prefix reading", () => {
    expect(kanaSpellings("気をもたせる", ["あい-"])).toContain("あいをもたせる");
  });

  it("reports which kanji it rewrote, so the caller can check the entry", () => {
    expect(spell("気をもたせる", ["き"]).literal).toBe("気");
    expect(spell("もたせる", ["き"]).literal).toBe("");
  });
});
