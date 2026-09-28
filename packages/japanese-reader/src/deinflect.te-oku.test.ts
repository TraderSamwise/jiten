import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

const words = (text: string) => deinflect(text).map((candidate) => candidate.word);

/**
 * ～とく / ～どく is the spoken contraction of ～ておく, and the reader met it as
 * 置いとくからだよ — where 置い reaches nothing, so the bare kanji 置 fell
 * through to the surname おき.
 */
describe("te-oku contraction", () => {
  it("reaches the verb through ～とく", () => {
    expect(words("置いとく")).toContain("置く");
    expect(words("やっとく")).toContain("やる");
    expect(words("見とく")).toContain("見る");
  });

  it("reaches the verb through the voiced ～どく", () => {
    expect(words("読んどく")).toContain("読む");
    expect(words("飲んどく")).toContain("飲む");
  });

  it("carries on through the contraction's own inflections", () => {
    expect(words("置いといた")).toContain("置く");
    expect(words("置いといて")).toContain("置く");
    expect(words("買っとこう")).toContain("買う");
  });

  /** Stripping ～とく off nothing invents a verb out of nothing. */
  it("refuses a bare とく, which has no stem to carry a te-form", () => {
    expect(words("とく")).not.toContain("て");
    expect(words("どく")).not.toContain("で");
  });
});
