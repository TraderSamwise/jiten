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

const ruleFor = (selector: string) => {
  const at = readerCss.indexOf(`${selector} {`);
  expect(at, `${selector} rule missing from reader.css`).toBeGreaterThan(-1);
  // Declarations only — a comment mentioning margin is not a margin.
  return readerCss.slice(at, readerCss.indexOf("}", at)).replace(/\/\*[\s\S]*?\*\//g, "");
};

const bookmarkRule = () => ruleFor(".bookmarked-word");

/** The three rules for a word that furigana split into several spans. */
const PART_SELECTORS = [
  ".bookmarked-word-start",
  ".bookmarked-word-middle",
  ".bookmarked-word-end",
];

/**
 * Half a second of holding a finger on text is iOS's own gesture too, and it
 * answers with a loupe and a word selection that lands on a different span than
 * the press is about. Only `user-select: none` on the text itself stops it;
 * `preventDefault` on `selectstart` is too late, because the loupe comes up
 * before any selection starts.
 */
describe("the reader refuses the platform's own text selection", () => {
  it("turns off native selection on the text, not only the page number", () => {
    const rule = ruleFor("#content");
    expect(rule).toMatch(/-webkit-user-select:\s*none/);
    expect(rule).toMatch(/[^-]user-select:\s*none/);
    expect(rule).toMatch(/-webkit-touch-callout:\s*none/);
  });
});

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

  /**
   * A word whose kanji carries furigana is painted as several spans, because
   * the kanji is inside the <ruby> element and the okurigana after it. With
   * the ring on every span the word was parted from itself — 飽 | きない. The
   * parts drop the ring on the edge they join along, and text runs top to
   * bottom here, so that edge is the bottom of one and the top of the next.
   */
  it("does not ring the edge where two parts of one word meet", () => {
    const shadow = (selector: string) => {
      const rule = ruleFor(selector);
      const at = rule.indexOf("box-shadow:");
      expect(at, `${selector} draws no ring`).toBeGreaterThan(-1);
      return rule.slice(at, rule.indexOf(";", at));
    };
    // `inset 0 1px` is the top edge, `inset 0 -1px` the bottom.
    expect(shadow(".bookmarked-word-start")).toContain("inset 0 1px");
    expect(shadow(".bookmarked-word-start")).not.toContain("inset 0 -1px");
    expect(shadow(".bookmarked-word-end")).toContain("inset 0 -1px");
    expect(shadow(".bookmarked-word-end")).not.toContain("inset 0 1px");
    expect(shadow(".bookmarked-word-middle")).not.toMatch(/inset 0 -?1px/);
    // All three keep the sides, so the word still has an outline.
    for (const selector of PART_SELECTORS) {
      expect(shadow(selector)).toContain("inset 1px 0");
      expect(shadow(selector)).toContain("inset -1px 0");
    }
  });

  it("moves no text in the part rules either", () => {
    const moves = /^(margin|padding|border(?!-radius)|letter-spacing|word-spacing|inset|translate)/;
    for (const selector of PART_SELECTORS) {
      const declared = ruleFor(selector)
        .split(";")
        .map((declaration) => declaration.split(":")[0].trim())
        .filter(Boolean);
      for (const property of declared) {
        expect(property, `${selector} ${property} would shift the pagination`).not.toMatch(moves);
      }
    }
  });
});
