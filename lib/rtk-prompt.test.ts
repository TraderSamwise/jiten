import { describe, expect, it } from "vitest";

import { kanjiMnemonicRequestSchema } from "./api-contract";
import {
  MAX_KEYWORD_CHARS,
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
    expect(request).toEqual({ kanji: "親", keyword: "parent", primitives: ["needle", "tree"] });
  });

  it("prefers the keyword the user set over Heisig's", () => {
    const one = [primitive(1, "needle")];
    expect(mnemonicRequestFor(frame, one, "folks")?.keyword).toBe("folks");
    expect(mnemonicRequestFor(frame, one, "   ")?.keyword).toBe("parent");
    expect(mnemonicRequestFor(frame, one, null)?.keyword).toBe("parent");
  });

  it("has nothing to ask when there is no keyword at all", () => {
    const one = [primitive(1, "needle")];
    expect(mnemonicRequestFor({ ...frame, keyword: "" }, one)).toBeNull();
    expect(mnemonicRequestFor({ ...frame, keyword: "  " }, one, "")).toBeNull();
  });

  it("has nothing to ask for a frame with no primitives to weave", () => {
    // The instruction builds the imagery out of them; an empty list buys a
    // generic story for a unit of the learner's daily quota.
    expect(mnemonicRequestFor(frame, [])).toBeNull();
    expect(mnemonicRequestFor(frame, [primitive(1, null)])).toBeNull();
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
    expect(mnemonicRequestFor(frame, [primitive(1, "needle")], long)?.keyword).toHaveLength(
      MAX_KEYWORD_CHARS,
    );
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
