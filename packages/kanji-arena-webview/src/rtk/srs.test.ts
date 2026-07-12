import { describe, expect, it } from "vitest";
import type { KanjiEntry } from "./corpus";
import { dependencyOrder } from "./srs";

// A minimal new-card entry; only kanji + primitives matter to dependencyOrder.
function entry(kanji: string, primitiveGlyphs: string[]): KanjiEntry {
  return {
    kanji,
    keyword: kanji,
    verb: "burn",
    primitives: primitiveGlyphs.map((g) => ({ keyword: g, glyph: g })),
    story: "",
    strokes: 1,
  };
}

const orderOf = (es: KanjiEntry[]) => es.map((e) => e.kanji);

describe("dependencyOrder", () => {
  it("introduces an in-set primitive before the compound that uses it", () => {
    // 克 is built from 十 + 兄; all three are new. 兄 must precede 克.
    const out = orderOf(
      dependencyOrder([entry("克", ["十", "兄"]), entry("兄", ["口", "儿"]), entry("十", [])]),
    );
    expect(out.indexOf("兄")).toBeLessThan(out.indexOf("克"));
    expect(out.indexOf("十")).toBeLessThan(out.indexOf("克"));
  });

  it("orders transitively (primitive of a primitive)", () => {
    // A ← B ← C: C uses B, B uses A. Order must be A, B, C.
    const out = orderOf(dependencyOrder([entry("C", ["B"]), entry("B", ["A"]), entry("A", [])]));
    expect(out).toEqual(["A", "B", "C"]);
  });

  it("ignores primitives not present in the new set (already learned or not in deck)", () => {
    // 兄 is a primitive of 克 but is NOT in this set → no constraint; order preserved.
    const input = [entry("克", ["兄"]), entry("災", [])];
    expect(orderOf(dependencyOrder(input))).toEqual(["克", "災"]);
  });

  it("never drops entries and terminates on a cycle", () => {
    const out = dependencyOrder([entry("X", ["Y"]), entry("Y", ["X"])]);
    expect(orderOf(out).sort()).toEqual(["X", "Y"]);
  });

  it("ignores a self-referential primitive", () => {
    expect(orderOf(dependencyOrder([entry("木", ["木"])]))).toEqual(["木"]);
  });

  it("ignores invented (display-only) primitives with no real glyph", () => {
    // A's part references B by an invented shape (display, no glyph) — not a real
    // kanji, so no dependency even though a card named B is in the set.
    const a: KanjiEntry = {
      kanji: "A",
      keyword: "A",
      verb: "burn",
      primitives: [{ keyword: "B", display: "x" }],
      story: "",
      strokes: 1,
    };
    expect(orderOf(dependencyOrder([a, entry("B", [])]))).toEqual(["A", "B"]);
  });
});
