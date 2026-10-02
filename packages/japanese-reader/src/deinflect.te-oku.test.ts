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

  /**
   * The imperative of the bare ～とく, which the godan stems already spell out
   * as いとけ / っとけ / んどけ. Without it やめとけ is not a word at all, and a
   * page that says it reads as やめ + とけ — two real tokens, so a bookmarked
   * 解ける lights up on the second half.
   */
  it("reaches an ichidan verb through ～とけ", () => {
    expect(words("やめとけ")).toContain("やめる");
    expect(words("見とけ")).toContain("見る");
    expect(words("食べとけ")).toContain("食べる");
  });

  it("refuses a bare とけ, which has no stem to carry a te-form", () => {
    expect(words("とけ")).not.toContain("て");
  });

  /**
   * The bare ～とけ has to sit BELOW the godan ones. The first rule to reach a
   * word owns its type, so placed above them it types 置いとけ as ichidan and
   * 置いて never finishes the journey to 置く.
   */
  it("still reaches a godan verb through いとけ, っとけ and んどけ", () => {
    expect(words("置いとけ")).toContain("置く");
    expect(words("やっとけ")).toContain("やる");
    expect(words("待っとけ")).toContain("待つ");
    expect(words("読んどけ")).toContain("読む");
  });

  /** Stripping ～とく off nothing invents a verb out of nothing. */
  it("refuses a bare とく, which has no stem to carry a te-form", () => {
    expect(words("とく")).not.toContain("て");
    expect(words("どく")).not.toContain("で");
  });
});
