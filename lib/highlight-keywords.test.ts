import { describe, expect, it } from "vitest";
import { highlightKeywords } from "./highlight-keywords";

describe("highlightKeywords", () => {
  it("returns empty array for empty text", () => {
    expect(highlightKeywords("", ["guard"], [])).toEqual([]);
  });

  it("returns single plain segment when no keywords supplied", () => {
    expect(highlightKeywords("hello world", [], [])).toEqual([
      { text: "hello world", type: "plain" },
    ]);
  });

  it("tags primary keyword as primary", () => {
    const segs = highlightKeywords("A guard at the gate.", ["guard"], []);
    const primary = segs.find((s) => s.type === "primary");
    expect(primary?.text).toBe("guard");
  });

  it("tags component keyword as component when no primary overlaps", () => {
    const segs = highlightKeywords("Built into the house.", [], ["house"]);
    const comp = segs.find((s) => s.type === "component");
    expect(comp?.text).toBe("house");
  });

  it("prefers primary over component when same word appears in both lists", () => {
    const segs = highlightKeywords("A guard.", ["guard"], ["guard"]);
    expect(segs.find((s) => s.type === "primary")?.text).toBe("guard");
    expect(segs.find((s) => s.type === "component")).toBeUndefined();
  });

  it("matches simple inflections (plural -s, past -ed, gerund -ing)", () => {
    const text = "Guards guarded the guarding gates.";
    const segs = highlightKeywords(text, ["guard"], []);
    const primaries = segs.filter((s) => s.type === "primary").map((s) => s.text.toLowerCase());
    expect(primaries).toContain("guards");
    expect(primaries).toContain("guarded");
    expect(primaries).toContain("guarding");
  });

  it("skips common stop words supplied as keywords", () => {
    const segs = highlightKeywords("the house in the gate", ["the"], ["in"]);
    expect(segs.every((s) => s.type !== "primary" || s.text !== "the")).toBe(true);
    expect(segs.every((s) => s.type !== "component" || s.text !== "in")).toBe(true);
  });

  it("reconstructs the original text from concatenated segments", () => {
    const text = "A guard holds the house up.";
    const segs = highlightKeywords(text, ["guard"], ["house"]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
});
