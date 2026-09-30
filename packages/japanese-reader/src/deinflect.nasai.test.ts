import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

const words = (text: string) => deinflect(text).map((candidate) => candidate.word);

/**
 * ～なさい is the polite imperative, built on the masu-stem: 喋りなさい, 見なさい,
 * 早くしなさい. It reached the reader as 喋っちゃいなさいって, where it sits on
 * top of the ～ちゃう contraction.
 */
describe("nasai imperative", () => {
  it("reaches a godan verb", () => {
    expect(words("喋りなさい")).toContain("喋る");
    expect(words("書きなさい")).toContain("書く");
    expect(words("読みなさい")).toContain("読む");
    expect(words("待ちなさい")).toContain("待つ");
  });

  it("reaches an ichidan verb", () => {
    expect(words("食べなさい")).toContain("食べる");
    expect(words("見なさい")).toContain("見る");
  });

  it("reaches する and 来る", () => {
    expect(words("しなさい")).toContain("する");
    expect(words("きなさい")).toContain("くる");
  });

  it("sits on top of the ～ちゃう contraction", () => {
    expect(words("喋っちゃいなさい")).toContain("喋る");
  });

  /** な on its own is the negative imperative, not a truncated なさい. */
  it("needs a stem in front of it", () => {
    expect(words("なさい")).not.toContain("る");
    expect(words("なさい")).not.toContain("う");
  });
});
