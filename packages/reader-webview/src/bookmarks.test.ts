/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { resetBookmarkHighlightState, setBookmarkHighlights } from "./bookmarks";
import { state } from "./state";

function setPageHtml(html: string) {
  document.body.innerHTML = `<div id="page">${html}</div>`;
  state.pageEl = document.getElementById("page");
  state.contentEl = state.pageEl;
  resetBookmarkHighlightState();
}

describe("setBookmarkHighlights", () => {
  beforeEach(() => {
    setPageHtml("");
  });

  it("highlights ruby base text without wrapping rt content", () => {
    setPageHtml("<p><ruby>理髪<rt>りはつ</rt></ruby>した</p>");

    setBookmarkHighlights({ version: "1", surfaces: ["理髪"] });

    expect(state.pageEl!.innerHTML).toContain(
      '<ruby><span class="bookmarked-word">理髪</span><rt>りはつ</rt></ruby>',
    );
    expect(state.pageEl!.innerHTML).not.toContain('<span class="bookmarked-word">りはつ</span>');
  });

  it("removes stale bookmark wrappers when the target set changes", () => {
    setPageHtml("<p>助手席</p>");

    setBookmarkHighlights({ version: "1", surfaces: ["助手席"] });
    setBookmarkHighlights({ version: "2", surfaces: [] });

    expect(state.pageEl!.innerHTML).toBe("<p>助手席</p>");
  });

  it("prefers the longest matching surface", () => {
    setPageHtml("<p>助手席</p>");

    setBookmarkHighlights({ version: "1", surfaces: ["助手", "助手席"] });

    expect(state.pageEl!.innerHTML).toBe('<p><span class="bookmarked-word">助手席</span></p>');
  });

  it("does not match across paragraph boundaries", () => {
    setPageHtml("<p>花</p><p>屋</p>");

    setBookmarkHighlights({ version: "1", surfaces: ["花屋"] });

    expect(state.pageEl!.innerHTML).toBe("<p>花</p><p>屋</p>");
  });
});
