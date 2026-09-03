import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

function bases(word: string): string[] {
  return deinflect(word).map((c) => c.word);
}

// The godan half of the masu-stem (走り→走る, 書き→書く) was already in the rule
// table; the ichidan half was not, so a 連用形 joining two clauses resolved to
// nothing and the tap fell back to a fragment — 見上げ、gave 上げ "tuck".
describe("ichidan masu-stem (連用形)", () => {
  it("recovers the dictionary form from an ichidan stem", () => {
    expect(bases("見上げ")).toContain("見上げる");
    expect(bases("食べ")).toContain("食べる");
    expect(bases("くたびれ")).toContain("くたびれる");
    expect(bases("伝え")).toContain("伝える");
  });

  it("keeps the reason label shared with the godan stem rules", () => {
    const hit = deinflect("見上げ").find((c) => c.word === "見上げる");
    expect(hit?.reasons).toEqual(["masu-stem"]);
  });

  it("only fires on え/い-row endings, so あ/う/お-row words invent nothing", () => {
    expect(bases("たか")).not.toContain("たかる");
    expect(bases("そう")).not.toContain("そうる");
    expect(bases("ほど")).not.toContain("ほどる");
  });

  it("needs a stem, so a bare one-kana word is left alone", () => {
    expect(bases("げ")).not.toContain("げる");
    expect(bases("れ")).not.toContain("れる");
  });

  it("leaves the exact surface as the first candidate", () => {
    expect(deinflect("上げ")[0].word).toBe("上げ");
    expect(deinflect("それ")[0].word).toBe("それ");
  });
});
