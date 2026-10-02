/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { resetBookmarkHighlightState, setBookmarkHighlights, tappedRun } from "./bookmarks";
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

    setBookmarkHighlights({ version: "1", runs: [{ run: "理髪した", spans: [[0, 2]] }] });

    expect(state.pageEl!.innerHTML).toContain(
      '<ruby><span class="bookmarked-word">理髪</span><rt>りはつ</rt></ruby>',
    );
    expect(state.pageEl!.innerHTML).not.toContain('<span class="bookmarked-word">りはつ</span>');
  });

  it("removes stale bookmark wrappers when the target set changes", () => {
    setPageHtml("<p>助手席</p>");

    setBookmarkHighlights({ version: "1", runs: [{ run: "助手席", spans: [[0, 3]] }] });
    setBookmarkHighlights({ version: "2", runs: [] });

    expect(state.pageEl!.innerHTML).toBe("<p>助手席</p>");
  });

  it("paints the span the matcher asked for, not the longest it can find", () => {
    setPageHtml("<p>助手席</p>");

    setBookmarkHighlights({ version: "1", runs: [{ run: "助手席", spans: [[0, 3]] }] });

    expect(state.pageEl!.innerHTML).toBe('<p><span class="bookmarked-word">助手席</span></p>');
  });

  /**
   * The whole point of placements. Before them the painter took a set of
   * surfaces and painted every occurrence, so a word confirmed in one place
   * lit up in another — つい inside について.
   */
  it("paints an occurrence only where the matcher placed it", () => {
    setPageHtml("<p>つい笑った。これについて。</p>");

    setBookmarkHighlights({
      version: "1",
      runs: [{ run: "つい笑った", spans: [[0, 2]] }],
    });

    expect(state.pageEl!.innerHTML).toBe(
      '<p><span class="bookmarked-word">つい</span>笑った。これについて。</p>',
    );
  });

  it("does not match across paragraph boundaries", () => {
    setPageHtml("<p>花</p><p>屋</p>");

    // 花屋 is not a run on this page at all; each block holds one character.
    setBookmarkHighlights({ version: "1", runs: [{ run: "花屋", spans: [[0, 2]] }] });

    expect(state.pageEl!.innerHTML).toBe("<p>花</p><p>屋</p>");
  });

  it("ignores a span that runs past the end of its run", () => {
    setPageHtml("<p>助手</p>");

    setBookmarkHighlights({ version: "1", runs: [{ run: "助手", spans: [[0, 3]] }] });

    expect(state.pageEl!.innerHTML).toBe("<p>助手</p>");
  });
});

/**
 * The reader swaps the content after the last laid-out character, which cuts
 * a paragraph in the DOM. The matcher's own copy is cut at the same place
 * (`truncateHtmlAtVisibleChars`), so a placement is never offered for a run
 * the page shows only part of — and a run the matcher never placed is never
 * painted, however much of it matches.
 */
describe("a run the page shows only part of", () => {
  it("paints nothing, rather than guessing which placement it was", () => {
    setPageHtml("<p>助手席に座</p>");

    setBookmarkHighlights({
      version: "1",
      runs: [{ run: "助手席に座る", spans: [[0, 3]] }],
    });

    expect(state.pageEl!.innerHTML).toBe("<p>助手席に座</p>");
  });
});

describe("tappedRun", () => {
  const tapAt = (html: string, nth: number, offset: number) => {
    setPageHtml(html);
    const walker = document.createTreeWalker(state.pageEl!, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    for (let i = 0; i <= nth; i++) node = walker.nextNode();
    return tappedRun(node!, offset);
  };

  it("reports the whole run and where in it the tap landed", () => {
    expect(tapAt("<p>その件について話をした。</p>", 0, 8)).toEqual({
      run: "その件について話をした",
      offset: 8,
    });
  });

  it("stops at the punctuation that ends the run", () => {
    expect(tapAt("<p>つい笑った。これについて。</p>", 0, 8)).toEqual({
      run: "これについて",
      offset: 2,
    });
  });

  /** The window a tap sends would have fused these; a run never crosses. */
  it("does not cross a paragraph", () => {
    expect(tapAt("<p>花</p><p>屋</p>", 1, 0)).toEqual({ run: "屋", offset: 0 });
  });

  it("joins the text either side of furigana", () => {
    expect(tapAt("<p><ruby>理髪<rt>りはつ</rt></ruby>した</p>", 0, 0)).toEqual({
      run: "理髪した",
      offset: 0,
    });
  });

  it("has nothing to say about a tap on punctuation", () => {
    expect(tapAt("<p>花。屋</p>", 0, 1)).toBeNull();
  });
});
