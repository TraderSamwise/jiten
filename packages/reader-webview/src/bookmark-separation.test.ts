/**
 * Adjacent bookmarked words used to merge into one block — 料金 and 発生 side
 * by side read as a single highlighted word. They are separated by a ring
 * painted in the page background, and it has to be paint rather than layout:
 * the pagination engine measures character geometry by absolute offset, so a
 * margin or padding on a highlight would move every character after it and
 * change where pages break.
 */
import { describe, expect, it } from "vitest";
import { readerCss } from "../bundle";

const bookmarkRule = () => {
  const at = readerCss.indexOf(".bookmarked-word");
  expect(at, ".bookmarked-word rule missing from reader.css").toBeGreaterThan(-1);
  // Declarations only — a comment mentioning margin is not a margin.
  return readerCss.slice(at, readerCss.indexOf("}", at)).replace(/\/\*[\s\S]*?\*\//g, "");
};

describe("bookmark highlight separation", () => {
  it("separates adjacent highlights with a ring of page background", () => {
    const rule = bookmarkRule();
    expect(rule).toMatch(/box-shadow:[^;]*var\(--reader-bg\)/);
  });

  it("uses no property that would move the text", () => {
    // border-radius is shape, not space, so match property names rather than
    // substrings: "border" alone would reject the radius the rule needs.
    const moves = /^(margin|padding|border(?!-radius)|letter-spacing|word-spacing|inset|translate)/;
    const declared = bookmarkRule()
      .split(";")
      .map((declaration) => declaration.split(":")[0].trim())
      .filter(Boolean);
    for (const property of declared) {
      expect(property, `${property} would shift the pagination`).not.toMatch(moves);
    }
  });

  it("keeps the highlight itself", () => {
    expect(bookmarkRule()).toContain("var(--reader-bookmark-bg)");
  });
});
