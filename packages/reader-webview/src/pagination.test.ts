/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportScroll } from "./pagination";
import { state } from "./state";

interface ScrollMessage {
  type: string;
  charOffset: number;
  isLastPage: boolean;
}

function lastScrollMessage(post: ReturnType<typeof vi.fn>): ScrollMessage {
  return JSON.parse(post.mock.calls.at(-1)![0] as string) as ScrollMessage;
}

describe("reportScroll isLastPage", () => {
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom has no layout, so Range lacks getBoundingClientRect. reportScroll
    // only needs it to not throw — the offset it reports comes from
    // canonicalCharOffset, and isLastPage is what these tests assert on.
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    document.body.innerHTML = `<div id="page">本文</div>`;
    state.pageEl = document.getElementById("page");
    state.contentEl = state.pageEl;
    state.canonicalCharOffset = 42;
    state.currentPage = 1;
    state.totalPages = 1;
    state.paginated = false;
    post = vi.fn();
    (window as unknown as { ReactNativeWebView: { postMessage: unknown } }).ReactNativeWebView = {
      postMessage: post,
    };
  });

  // The 1/1 state defaults read as "last page" before anything is measured. A
  // scroll reported then persists read_complete, which shows the book at 100%
  // in the library even though the saved char offset is mid-book.
  it("does not claim the last page before pagination has measured", () => {
    reportScroll();
    expect(lastScrollMessage(post).isLastPage).toBe(false);
  });

  it("reports the last page once measured and on the final page", () => {
    state.paginated = true;
    state.currentPage = 7;
    state.totalPages = 7;
    reportScroll();
    expect(lastScrollMessage(post).isLastPage).toBe(true);
  });

  it("does not report the last page when measured mid-book", () => {
    state.paginated = true;
    state.currentPage = 3;
    state.totalPages = 7;
    reportScroll();
    expect(lastScrollMessage(post).isLastPage).toBe(false);
  });
});
