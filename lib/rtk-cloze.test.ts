import { describe, expect, it } from "vitest";

import { accepts, BLANK, canCloze, clozed } from "./rtk-cloze";

describe("taking the keyword out of a story", () => {
  it("blanks the markup's own token for it", () => {
    expect(clozed("a [needle] through a [tree] is a {self}", "parent")).toBe(
      `a [needle] through a [tree] is a ${BLANK}`,
    );
  });

  it("leaves the primitive references alone", () => {
    const out = clozed("the {self} holds a [house](p12)", "parent");
    expect(out).toContain("[house](p12)");
    expect(out).toContain(BLANK);
  });

  it("blanks the keyword where it was written out instead", () => {
    expect(clozed("a parent with a needle", "parent")).toBe(`a ${BLANK} with a needle`);
  });

  it("blanks it however it was capitalised", () => {
    expect(clozed("Parent and parent", "parent")).toBe(`${BLANK} and ${BLANK}`);
  });

  it("does not punch a hole in a longer word", () => {
    expect(clozed("the art of starting", "art")).toBe(`the ${BLANK} of starting`);
  });

  it("treats a keyword with regex characters as text", () => {
    expect(clozed("a (test) case", "(test)")).toBe(`a ${BLANK} case`);
  });

  it("leaves a story that never names it", () => {
    expect(clozed("a needle and a tree", "parent")).toBe("a needle and a tree");
  });
});

describe("whether a frame can be clozed", () => {
  it("can, with {self}", () => {
    expect(canCloze("the {self} again", "parent")).toBe(true);
  });

  it("can, with the keyword written out", () => {
    expect(canCloze("a parent again", "parent")).toBe(true);
  });

  it("cannot, with no story", () => {
    expect(canCloze(null, "parent")).toBe(false);
    expect(canCloze("   ", "parent")).toBe(false);
  });

  it("cannot, when the story never names the keyword", () => {
    expect(canCloze("a needle and a tree", "parent")).toBe(false);
  });

  it("cannot, with no keyword to hide", () => {
    expect(canCloze("the {self} again", "  ")).toBe(false);
  });
});

describe("what counts as the keyword", () => {
  it("takes it exactly", () => {
    expect(accepts("parent", "parent")).toBe(true);
    expect(accepts("  PARENT ", "parent")).toBe(true);
  });

  it("forgives a plural or a tense", () => {
    expect(accepts("parents", "parent")).toBe(true);
    expect(accepts("proclaiming", "proclaim")).toBe(true);
  });

  it("takes a synonym the dictionary knows", () => {
    expect(accepts("folks", "parent", ["folks", "kin"])).toBe(true);
    expect(accepts("kinship", "parent", ["kin"])).toBe(false);
  });

  it("refuses something else", () => {
    expect(accepts("needle", "parent")).toBe(false);
    expect(accepts("", "parent")).toBe(false);
    expect(accepts("   ", "parent")).toBe(false);
  });
});
