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
    const rule = bookmarkRule();
    for (const layoutProperty of [
      "margin",
      "padding",
      "border",
      "letter-spacing",
      "word-spacing",
    ]) {
      expect(rule, `${layoutProperty} would shift the pagination`).not.toContain(layoutProperty);
    }
  });

  it("keeps the highlight itself", () => {
    expect(bookmarkRule()).toContain("var(--reader-bookmark-bg)");
  });
});
