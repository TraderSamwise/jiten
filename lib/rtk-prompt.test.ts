import { describe, expect, it } from "vitest";

import { kanjiMnemonicRequestSchema } from "./api-contract";
import {
  MAX_EXAMPLES,
  MAX_KEYWORD_CHARS,
  MAX_MY_WORDS,
  MAX_PRIMITIVES,
  mnemonicRequestFor,
  primitiveKeywords,
} from "./rtk-prompt";
import type { CourseFrame } from "./rtk-course";
import type { KanjiPrimitive } from "@/db/types";

const frame: CourseFrame = { literal: "親", index: 1621, keyword: "parent", lesson: 39 };

function primitive(position: number, keyword: string | null): KanjiPrimitive {
  return {
    position,
    glyph: null,
    primitiveId: position,
    keyword,
    isPrimitive: true,
    displayGlyph: null,
  };
}

describe("what the generator is told", () => {
  it("sends the kanji, its keyword and its primitives", () => {
    const request = mnemonicRequestFor(frame, [primitive(1, "needle"), primitive(2, "tree")]);
    expect(request).toEqual({
      kanji: "親",
      keyword: "parent",
      primitives: ["needle", "tree"],
      myWords: [],
      examples: [],
    });
  });

  it("prefers the keyword the user set over Heisig's", () => {
    expect(mnemonicRequestFor(frame, [], "folks")?.keyword).toBe("folks");
    expect(mnemonicRequestFor(frame, [], "   ")?.keyword).toBe("parent");
    expect(mnemonicRequestFor(frame, [], null)?.keyword).toBe("parent");
  });

  it("has nothing to ask when there is no keyword at all", () => {
    expect(mnemonicRequestFor({ ...frame, keyword: "" }, [])).toBeNull();
    expect(mnemonicRequestFor({ ...frame, keyword: "  " }, [], "")).toBeNull();
  });

  it("keeps the primitives in writing order", () => {
    const keywords = primitiveKeywords([
      primitive(3, "third"),
      primitive(1, "first"),
      primitive(2, "second"),
    ]);
    expect(keywords).toEqual(["first", "second", "third"]);
  });

  it("drops blanks and repeats", () => {
    expect(
      primitiveKeywords([
        primitive(1, "tree"),
        primitive(2, null),
        primitive(3, "  "),
        primitive(4, "tree"),
        primitive(5, "root"),
      ]),
    ).toEqual(["tree", "root"]);
  });

  it("sends nothing for a frame the decomposition does not cover", () => {
    // 隙 匕 喩 嗅 惧 箋 have no components at all.
    expect(mnemonicRequestFor(frame, [])?.primitives).toEqual([]);
  });
});

describe("the learner's own archive", () => {
  it("sends the words they already use for these primitives", () => {
    const request = mnemonicRequestFor(frame, [], null, {
      myWords: ["needle", "home"],
      examples: ["a [needle] through a [tree]"],
    });
    expect(request).toMatchObject({
      myWords: ["needle", "home"],
      examples: ["a [needle] through a [tree]"],
    });
  });

  it("sends nothing when there is no archive yet", () => {
    expect(mnemonicRequestFor(frame, [])).toMatchObject({ myWords: [], examples: [] });
  });

  it("drops blanks and repeats", () => {
    expect(
      mnemonicRequestFor(frame, [], null, { myWords: ["home", " ", "home", "needle"] }),
    ).toMatchObject({ myWords: ["home", "needle"] });
  });

  it("sends no more than the contract keeps", () => {
    const request = mnemonicRequestFor(frame, [], null, {
      myWords: Array.from({ length: 30 }, (_, i) => `w${i}`),
      examples: Array.from({ length: 9 }, (_, i) => `story ${i}`),
    })!;
    expect(request.myWords).toHaveLength(MAX_MY_WORDS);
    expect(request.examples).toHaveLength(MAX_EXAMPLES);
    expect(kanjiMnemonicRequestSchema.parse(request)).toEqual(request);
  });
});

describe("the server's caps, honoured before the request leaves", () => {
  it("never sends more primitives than the contract keeps", () => {
    const many = Array.from({ length: 20 }, (_, i) => primitive(i + 1, `p${i}`));
    const sent = primitiveKeywords(many);
    // Measured against the schema, not against MAX_PRIMITIVES, or the
    // assertion would only ever agree with whatever this file declares.
    const kept = kanjiMnemonicRequestSchema.parse({
      kanji: "親",
      keyword: "parent",
      primitives: sent,
    }).primitives;
    expect(sent).toEqual(kept);
    expect(sent).toHaveLength(MAX_PRIMITIVES);
  });

  it("never sends a keyword longer than the contract keeps", () => {
    const long = "x".repeat(MAX_KEYWORD_CHARS + 50);
    expect(mnemonicRequestFor(frame, [], long)?.keyword).toHaveLength(MAX_KEYWORD_CHARS);
    expect(primitiveKeywords([primitive(1, long)])[0]).toHaveLength(MAX_KEYWORD_CHARS);
  });

  it("produces a request the server's own schema accepts unchanged", () => {
    const request = mnemonicRequestFor(
      frame,
      // Distinct, or dedup would collapse them before the cap is reached.
      Array.from({ length: 20 }, (_, i) => primitive(i + 1, `${i}-${"y".repeat(200)}`)),
      "z".repeat(200),
    )!;
    const parsed = kanjiMnemonicRequestSchema.parse(request);
    expect(parsed).toEqual(request);
  });
});
