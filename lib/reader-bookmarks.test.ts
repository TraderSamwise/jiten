import { describe, expect, it } from "vitest";
import { applyBookmarkHighlightsToHtml } from "./reader-bookmarks";

describe("applyBookmarkHighlightsToHtml", () => {
  it("wraps exact plain-text matches", () => {
    const html = "<p>助手席に座る。</p>";
    const highlighted = applyBookmarkHighlightsToHtml(html, new Set(["助手席"]));
    expect(highlighted).toContain('<span class="bookmarked-word">助手席</span>');
  });

  it("prefers longest matches first", () => {
    const html = "<p>助手席に座る。</p>";
    const highlighted = applyBookmarkHighlightsToHtml(html, new Set(["助手", "助手席"]));
    expect(highlighted).toContain('<span class="bookmarked-word">助手席</span>');
    expect(highlighted).not.toContain('<span class="bookmarked-word">助手</span>席');
  });

  it("skips rt content and can highlight ruby base text", () => {
    const html = "<p><ruby>理髪<rt>りはつ</rt></ruby>師</p>";
    const highlighted = applyBookmarkHighlightsToHtml(html, new Set(["理髪"]));
    expect(highlighted).toContain(
      '<ruby><span class="bookmarked-word">理髪</span><rt>りはつ</rt></ruby>',
    );
    expect(highlighted).not.toContain('<span class="bookmarked-word">理髪<rt>');
  });
});
