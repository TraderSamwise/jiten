import { describe, it, expect } from "vitest";
import {
  parseMnemonicMarkup,
  serializeMnemonicMarkup,
  convertLegacySigils,
  isValidTarget,
  type MarkupNode,
} from "./mnemonic-markup";

describe("parseMnemonicMarkup", () => {
  it("parses plain text as a single text node", () => {
    expect(parseMnemonicMarkup("just a story")).toEqual([{ type: "text", value: "just a story" }]);
  });

  it("parses {self}, bare refs, and targeted refs", () => {
    expect(parseMnemonicMarkup("I {self} my [house](p51) and [span](亘).")).toEqual([
      { type: "text", value: "I " },
      { type: "self" },
      { type: "text", value: " my " },
      { type: "ref", label: "house", target: "p51" },
      { type: "text", value: " and " },
      { type: "ref", label: "span", target: "亘" },
      { type: "text", value: "." },
    ]);
  });

  it("keeps a bare ref and treats following prose parens as literal", () => {
    expect(parseMnemonicMarkup("my [home] (the big one)")).toEqual([
      { type: "text", value: "my " },
      { type: "ref", label: "home", target: null },
      { type: "text", value: " (the big one)" },
    ]);
  });

  it("only consumes (target) when immediately after ] and valid", () => {
    // (c) is not a valid target → literal
    expect(parseMnemonicMarkup("[a](p1)(c)")).toEqual([
      { type: "ref", label: "a", target: "p1" },
      { type: "text", value: "(c)" },
    ]);
  });

  it("handles adjacent refs", () => {
    expect(parseMnemonicMarkup("[a][b]")).toEqual([
      { type: "ref", label: "a", target: null },
      { type: "ref", label: "b", target: null },
    ]);
  });

  it("degrades unclosed/nested brackets to literal text without throwing", () => {
    expect(parseMnemonicMarkup("an [unclosed ref")).toEqual([
      { type: "text", value: "an [unclosed ref" },
    ]);
    // a nested '[' aborts the outer ref (literal '['), then the inner [b] recovers as a ref
    expect(parseMnemonicMarkup("[a[b]")).toEqual([
      { type: "text", value: "[a" },
      { type: "ref", label: "b", target: null },
    ]);
    expect(parseMnemonicMarkup("{self")).toEqual([{ type: "text", value: "{self" }]);
  });

  it("respects escapes for literal specials", () => {
    expect(parseMnemonicMarkup("a \\[literal\\] and \\{self\\}")).toEqual([
      { type: "text", value: "a [literal] and {self}" },
    ]);
  });

  it("allows spaces and escaped brackets inside a label", () => {
    expect(parseMnemonicMarkup("[my little home]")).toEqual([
      { type: "ref", label: "my little home", target: null },
    ]);
    expect(parseMnemonicMarkup("[a\\]b](p2)")).toEqual([
      { type: "ref", label: "a]b", target: "p2" },
    ]);
  });

  it("rejects non-CJK single-char and multi-char targets", () => {
    expect(isValidTarget("p51")).toBe(true);
    expect(isValidTarget("亘")).toBe(true);
    expect(isValidTarget("b")).toBe(false);
    expect(isValidTarget("the big one")).toBe(false);
  });
});

describe("serializeMnemonicMarkup round-trips", () => {
  const cases: string[] = [
    "plain",
    "I {self} my [house](p51)",
    "text with [brackets] and {braces} literally: \\[x\\] \\{y\\}",
    "[a]b[c](亘) tail",
  ];
  for (const src of cases) {
    it(`parse→serialize→parse is stable for: ${src}`, () => {
      const ast = parseMnemonicMarkup(src);
      const reparsed = parseMnemonicMarkup(serializeMnemonicMarkup(ast));
      expect(reparsed).toEqual(ast);
    });
  }

  it("escapes literal brackets in text nodes so they don't reparse as refs", () => {
    const ast: MarkupNode[] = [{ type: "text", value: "a [not a ref] b" }];
    expect(parseMnemonicMarkup(serializeMnemonicMarkup(ast))).toEqual(ast);
  });

  it("keeps a bare ref distinct from following literal (target) parens", () => {
    const ast: MarkupNode[] = [
      { type: "ref", label: "a", target: null },
      { type: "text", value: "(p1)" },
    ];
    expect(parseMnemonicMarkup(serializeMnemonicMarkup(ast))).toEqual(ast);
    // and with a CJK glyph in the following prose
    const ast2: MarkupNode[] = [
      { type: "ref", label: "span", target: null },
      { type: "text", value: "(亘) note" },
    ];
    expect(parseMnemonicMarkup(serializeMnemonicMarkup(ast2))).toEqual(ast2);
  });
});

describe("convertLegacySigils", () => {
  it("converts **primary** to {self} and *component* to [component]", () => {
    expect(convertLegacySigils("I **proclaim** in my *house* that will *span*.")).toBe(
      "I {self} in my [house] that will [span].",
    );
  });

  it("processes double asterisks before single", () => {
    expect(convertLegacySigils("*a* **b** *c*")).toBe("[a] {self} [c]");
  });

  it("leaves unbalanced asterisks literal", () => {
    expect(convertLegacySigils("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("does not treat space-padded paired asterisks (prose/arithmetic) as markup", () => {
    expect(convertLegacySigils("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(convertLegacySigils("a ** b ** c")).toBe("a ** b ** c");
    // but a tightly-hugged single char still converts
    expect(convertLegacySigils("the *a* primitive")).toBe("the [a] primitive");
  });

  it("does not pair asterisks across unrelated tokens, newlines, or arithmetic", () => {
    // two multiplications must not merge into one ref (data-loss guard)
    expect(convertLegacySigils("note: 3*4=12 and 5*6=30")).toBe("note: 3*4=12 and 5*6=30");
    // a delimiter never pairs across a line break
    expect(convertLegacySigils("first *line\nsecond* line")).toBe("first *line\nsecond* line");
    // triple stars degrade without producing a garbage {self}-labeled ref
    expect(convertLegacySigils("***word***")).not.toContain("[{self}]");
    // real multi-token story still converts the intended spans
    expect(convertLegacySigils("I **relax** at *home*, then rest.")).toBe(
      "I {self} at [home], then rest.",
    );
    // a multi-word primitive keyword with internal spaces still converts
    expect(convertLegacySigils("the *walking stick* here")).toBe("the [walking stick] here");
  });

  it("escaped conversion output re-parses to refs", () => {
    const converted = convertLegacySigils("my *house* here");
    expect(parseMnemonicMarkup(converted)).toEqual([
      { type: "text", value: "my " },
      { type: "ref", label: "house", target: null },
      { type: "text", value: " here" },
    ]);
  });
});
