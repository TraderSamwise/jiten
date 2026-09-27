import { describe, expect, it } from "vitest";
import { particleVariants } from "./deinflect";

describe("particleVariants", () => {
  it("offers が where the text writes の", () => {
    // 目の玉が飛び出る is the entry; a relative clause writes its subject with の.
    expect(particleVariants("目の玉の飛び出る")).toContain("目の玉が飛び出る");
  });

  it("trades は, も and が for each other", () => {
    expect(particleVariants("役には立たない")).toContain("役にも立たない");
    expect(particleVariants("役にも立たない")).toContain("役には立たない");
    expect(particleVariants("腹が立たない")).toContain("腹は立たない");
  });

  it("trades に and へ", () => {
    expect(particleVariants("展覧会に出したら")).toContain("展覧会へ出したら");
    expect(particleVariants("展覧会へ出したら")).toContain("展覧会に出したら");
  });

  it("leaves particles alone whose case carries meaning", () => {
    const out = particleVariants("発破をかけてた");
    expect(out.every((v) => v.includes("を"))).toBe(true);
    expect(particleVariants("これで終わりだ").every((v) => v.includes("で"))).toBe(true);
  });

  it("swaps exactly one particle at a time", () => {
    // 目の玉の飛び出る has two の; no variant may change both.
    for (const variant of particleVariants("目の玉の飛び出る")) {
      const changed = [...variant].filter((ch, i) => ch !== "目の玉の飛び出る"[i]).length;
      expect(changed).toBe(1);
    }
  });

  /**
   * Below four characters a swap is not recovering a phrase, it is inventing a
   * different word: のか becomes がか, the common noun 画家.
   */
  it("refuses spans too short to be a phrase", () => {
    expect(particleVariants("のか")).toEqual([]);
    expect(particleVariants("はい")).toEqual([]);
    expect(particleVariants("もう")).toEqual([]);
  });

  it("returns nothing when there is no particle to swap", () => {
    expect(particleVariants("飛び出るような")).toEqual([]);
  });

  /** A phrase worth recovering has a kanji in it; a run of kana is grammar. */
  it("refuses a span with no kanji", () => {
    expect(particleVariants("でもないか")).toEqual([]);
    expect(particleVariants("というのが")).toEqual([]);
  });

  /**
   * 宿屋へ連れて来た is 連れる, "brought", but swapping the leading へ for に
   * reaches につれて, "as it progressed". A particle in first position belongs
   * to the phrase before this span.
   */
  it("refuses to swap the first character", () => {
    expect(particleVariants("へ連れて来た")).toEqual([]);
    expect(particleVariants("に対しては強い")).not.toContain("が対しては強い");
  });

  it("does not repeat itself or return the input", () => {
    const out = particleVariants("役には立たない");
    expect(out).toEqual([...new Set(out)]);
    expect(out).not.toContain("役には立たない");
  });
});
