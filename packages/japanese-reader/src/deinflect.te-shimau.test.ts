import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

const words = (text: string) => deinflect(text).map((candidate) => candidate.word);

/**
 * ～ちゃう / ～じゃう is the spoken contraction of ～てしまう / ～でしまう, and the
 * reader met it as 喋っちゃいなさいって, where nothing in the chain resolved and
 * the tap came back with fragments like っち and ちゃい.
 */
describe("te-shimau contraction", () => {
  it("reaches the verb through ～ちゃう", () => {
    expect(words("喋っちゃう")).toContain("喋る");
    expect(words("食べちゃう")).toContain("食べる");
    expect(words("やっちゃう")).toContain("やる");
  });

  it("reaches the verb through the voiced ～じゃう", () => {
    expect(words("読んじゃう")).toContain("読む");
    expect(words("死んじゃう")).toContain("死ぬ");
  });

  it("carries on through the contraction's own inflections", () => {
    expect(words("喋っちゃった")).toContain("喋る");
    expect(words("喋っちゃって")).toContain("喋る");
    expect(words("読んじゃった")).toContain("読む");
  });

  /** Stripping ～ちゃう off nothing invents a verb out of nothing. */
  it("refuses a bare ちゃう, which has no stem to carry a te-form", () => {
    expect(words("ちゃう")).not.toContain("て");
    expect(words("じゃう")).not.toContain("で");
  });
});
