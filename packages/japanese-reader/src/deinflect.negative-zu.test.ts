import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

function bases(word: string): string[] {
  return deinflect(word).map((c) => c.word);
}

// ～ず / ～ずに is the written negative, and the rule table only had ～ない. A
// tap inside 止まらずに therefore resolved nothing at all: 止まら is not a word,
// 止まらず deinflected to nothing, and the popup fell back to JMnedict names
// (止 = Itaru, Tomaru, …) for the bare kanji.
describe("negative ～ず", () => {
  it("recovers godan dictionary forms", () => {
    expect(bases("止まらず")).toContain("止まる");
    expect(bases("言わず")).toContain("言う");
    expect(bases("書かず")).toContain("書く");
    expect(bases("急がず")).toContain("急ぐ");
    expect(bases("出さず")).toContain("出す");
    expect(bases("待たず")).toContain("待つ");
    expect(bases("死なず")).toContain("死ぬ");
    expect(bases("呼ばず")).toContain("呼ぶ");
    expect(bases("読まず")).toContain("読む");
  });

  it("recovers ichidan, suru and kuru dictionary forms", () => {
    expect(bases("食べず")).toContain("食べる");
    expect(bases("せず")).toContain("する");
    expect(bases("来ず")).toContain("来る");
  });

  it("handles ～ずに", () => {
    expect(bases("止まらずに")).toContain("止まる");
    expect(bases("言わずに")).toContain("言う");
    expect(bases("せずに")).toContain("する");
  });

  it("labels the reason", () => {
    const hit = deinflect("止まらず").find((c) => c.word === "止まる");
    expect(hit?.reasons).toContain("negative");
  });

  it("does not strip ず off a word that is not an inflection", () => {
    expect(bases("水")).toEqual(["水"]);
  });
});
