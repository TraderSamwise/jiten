import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

const words = (text: string) => deinflect(text).map((candidate) => candidate.word);

/**
 * A contraction undoes a spoken shortening of the surface as written. Letting
 * it fire on another rule's output invents verbs: よっぽどほっとかれるか was read
 * as どほっとかれる → どほっとく → どほって → どほう, the crossbow 弩砲, from a span
 * that starts inside よっぽど.
 */
describe("contractions do not fire on another rule's output", () => {
  it("does not invent 弩砲 out of よっぽどほっとかれる", () => {
    expect(words("どほっとかれる")).not.toContain("どほう");
    expect(words("どほっとかれる")).not.toContain("どほる");
    expect(words("どほっとかれる")).not.toContain("どほつ");
  });

  it("still reads the contraction as written", () => {
    expect(words("置いとく")).toContain("置く");
    expect(words("飼っとく")).toContain("飼う");
    expect(words("読んどく")).toContain("読む");
    expect(words("見とく")).toContain("見る");
  });

  it("still reads the forms the contraction itself takes", () => {
    expect(words("置いといた")).toContain("置く");
    expect(words("置いといて")).toContain("置く");
    expect(words("買っとこう")).toContain("買う");
  });
});
