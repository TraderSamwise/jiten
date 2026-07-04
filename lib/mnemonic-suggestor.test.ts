import { describe, it, expect } from "vitest";
import {
  wordEndingAtCursor,
  activeBracketQuery,
  wrapAsRef,
  completeBracket,
  suppressionKey,
  filterPrimitivesByQuery,
  unlinkedPrimitives,
} from "./mnemonic-suggestor";
import { parseMnemonicMarkup } from "./mnemonic-markup";
import { canonicalStem } from "@/db/primitive-associations";
import type { KanjiPrimitive } from "@/db/types";

describe("wordEndingAtCursor", () => {
  it("returns the word whose trailing edge is at the cursor", () => {
    const t = "I relax at home";
    expect(wordEndingAtCursor(t, t.length)).toEqual({ start: 11, end: 15, text: "home" });
    expect(wordEndingAtCursor("I relax", 7)).toEqual({ start: 2, end: 7, text: "relax" });
  });

  it("returns null when the cursor is not just after a word char", () => {
    expect(wordEndingAtCursor("home ", 5)).toBeNull(); // trailing space
    expect(wordEndingAtCursor("", 0)).toBeNull();
    expect(wordEndingAtCursor("home", 0)).toBeNull(); // cursor at start (lastIndexOf(-1) guard)
  });

  it("does not offer inside an existing ref/self/target region", () => {
    // cursor inside [hou...
    expect(wordEndingAtCursor("my [house", 9)).toBeNull();
    // inside {self...
    expect(wordEndingAtCursor("a {self", 7)).toBeNull();
    // inside (target...
    expect(wordEndingAtCursor("[a](p1", 6)).toBeNull();
    // but plain text after a closed ref is fine
    expect(wordEndingAtCursor("[house] near home", 17)).toEqual({
      start: 13,
      end: 17,
      text: "home",
    });
  });
});

describe("activeBracketQuery", () => {
  it("returns the partial label of the last unclosed bracket", () => {
    expect(activeBracketQuery("my [hou", 7)).toEqual({ query: "hou", start: 3 });
    expect(activeBracketQuery("[", 1)).toEqual({ query: "", start: 0 });
  });

  it("returns null when there is no open bracket or it is closed/escaped", () => {
    expect(activeBracketQuery("plain text", 10)).toBeNull();
    expect(activeBracketQuery("[house] then", 12)).toBeNull();
    expect(activeBracketQuery("a \\[lit", 7)).toBeNull(); // escaped bracket, fail-safe
    expect(activeBracketQuery("[foo", 0)).toBeNull(); // cursor at start
  });
});

describe("wrapAsRef / completeBracket produce valid, correctly-reparsing markup", () => {
  it("wraps a bare word", () => {
    const r = wrapAsRef("I relax at home", { start: 11, end: 15, text: "home" }, null);
    expect(r.text).toBe("I relax at [home]");
    expect(r.cursor).toBe(r.text.length);
    expect(parseMnemonicMarkup(r.text)).toEqual([
      { type: "text", value: "I relax at " },
      { type: "ref", label: "home", target: null },
    ]);
  });

  it("wraps with a validated target", () => {
    const r = wrapAsRef("at home now", { start: 3, end: 7, text: "home" }, "p51");
    expect(r.text).toBe("at [home](p51) now");
    expect(parseMnemonicMarkup(r.text)[1]).toEqual({ type: "ref", label: "home", target: "p51" });
  });

  it("degrades an invalid target to a bare ref", () => {
    const r = wrapAsRef("at home", { start: 3, end: 7, text: "home" }, "not a target");
    expect(r.text).toBe("at [home]");
  });

  it("escapes a following literal '(' so a bare ref does not absorb it as a target", () => {
    const r = wrapAsRef("home(p5) x", { start: 0, end: 4, text: "home" }, null);
    // reparse must keep the ref bare and the parens as literal text
    const nodes = parseMnemonicMarkup(r.text);
    expect(nodes[0]).toEqual({ type: "ref", label: "home", target: null });
    expect(nodes[1]).toEqual({ type: "text", value: "(p5) x" });
  });

  it("completes an open bracket into a finished ref", () => {
    const q = activeBracketQuery("my [hou", 7)!;
    const r = completeBracket("my [hou", q.start, 7, "house", "p51");
    expect(r.text).toBe("my [house](p51)");
    expect(r.cursor).toBe(r.text.length);
  });

  it("completes a bare pick and escapes a following literal paren", () => {
    const r = completeBracket("[hou(x)", 0, 4, "house", null);
    const nodes = parseMnemonicMarkup(r.text);
    expect(nodes[0]).toEqual({ type: "ref", label: "house", target: null });
    expect(nodes[1]).toEqual({ type: "text", value: "(x)" });
  });
});

describe("stale spans no-op safely", () => {
  it("wrapAsRef leaves text unchanged for an out-of-range span", () => {
    expect(wrapAsRef("short", { start: 2, end: 99, text: "gone" }, null).text).toBe("short");
  });
  it("completeBracket leaves text unchanged when start > cursor", () => {
    expect(completeBracket("hi", 5, 1, "x", null).text).toBe("hi");
  });
});

describe("suppressionKey", () => {
  it("is the canonical stem so inflections share a key", () => {
    expect(suppressionKey("relaxing")).toBe(canonicalStem("relaxing"));
    expect(suppressionKey("relaxing")).toBe(suppressionKey("relaxes"));
  });
});

describe("filterPrimitivesByQuery", () => {
  const prims: KanjiPrimitive[] = [
    {
      position: 0,
      glyph: null,
      primitiveId: 51,
      keyword: "house",
      isPrimitive: true,
      displayGlyph: "屆",
    },
    {
      position: 1,
      glyph: "亘",
      primitiveId: null,
      keyword: "span",
      isPrimitive: false,
      displayGlyph: null,
    },
    {
      position: 2,
      glyph: "女",
      primitiveId: null,
      keyword: null,
      isPrimitive: false,
      displayGlyph: null,
    }, // no keyword
  ];

  it("returns all linkable primitives (target + keyword) for an empty query", () => {
    expect(filterPrimitivesByQuery(prims, "")).toEqual([
      { target: "p51", keyword: "house" },
      { target: "亘", keyword: "span" },
    ]);
  });

  it("filters by case-insensitive keyword substring and drops null-keyword entries", () => {
    expect(filterPrimitivesByQuery(prims, "HOU")).toEqual([{ target: "p51", keyword: "house" }]);
    expect(filterPrimitivesByQuery(prims, "zzz")).toEqual([]);
  });
});

describe("unlinkedPrimitives", () => {
  const prims: KanjiPrimitive[] = [
    {
      position: 0,
      glyph: null,
      primitiveId: 51,
      keyword: "house",
      isPrimitive: true,
      displayGlyph: "屆",
    },
    {
      position: 1,
      glyph: "亘",
      primitiveId: null,
      keyword: "span",
      isPrimitive: false,
      displayGlyph: null,
    },
    {
      position: 2,
      glyph: "女",
      primitiveId: null,
      keyword: null,
      isPrimitive: false,
      displayGlyph: null,
    },
  ];

  it("returns linkable primitives not yet referenced, by target or keyword stem", () => {
    // 'house' referenced by explicit target, 'span' not referenced yet
    expect(unlinkedPrimitives("my [house](p51) here", prims)).toEqual([
      {
        position: 1,
        glyph: "亘",
        primitiveId: null,
        keyword: "span",
        isPrimitive: false,
        displayGlyph: null,
      },
    ]);
  });

  it("treats a bare ref by keyword stem as linked", () => {
    expect(unlinkedPrimitives("my [spanning]", prims).map((p) => p.keyword)).toEqual(["house"]);
  });

  it("returns all linkable primitives when nothing is referenced", () => {
    expect(unlinkedPrimitives("plain story", prims).map((p) => p.keyword)).toEqual([
      "house",
      "span",
    ]);
  });
});
