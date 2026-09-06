import { describe, expect, it } from "vitest";
import { getReaderProgressFlushMode, isBookFinished } from "./reader-progress";

describe("getReaderProgressFlushMode", () => {
  it("skips the initial restored scroll event", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: false,
        isLastPage: false,
        lastPersistedReadComplete: false,
      }),
    ).toBe("skip");
  });

  it("schedules a normal flush for regular page changes", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: false,
        lastPersistedReadComplete: false,
      }),
    ).toBe("schedule");
  });

  it("flushes immediately when the reader first reaches completion", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: true,
        lastPersistedReadComplete: false,
      }),
    ).toBe("immediate");
  });

  it("schedules instead of forcing immediate flush after completion was already persisted", () => {
    expect(
      getReaderProgressFlushMode({
        initialScrollHandled: true,
        isLastPage: true,
        lastPersistedReadComplete: true,
      }),
    ).toBe("schedule");
  });
});

describe("isBookFinished", () => {
  // The reader loads a window of ~13 pages. Its last page is the end of that
  // window, not the end of the book — a jettisoned webview that remeasures a
  // degenerate layout reports it while the reader sits at 8%.
  it("rejects the window's last page when the book continues past it", () => {
    expect(
      isBookFinished({ isLastPageOfWindow: true, loadedEndChar: 9000, totalChars: 120000 }),
    ).toBe(false);
  });

  it("accepts the last page once the loaded window reaches the end of the book", () => {
    expect(
      isBookFinished({ isLastPageOfWindow: true, loadedEndChar: 120000, totalChars: 120000 }),
    ).toBe(true);
  });

  it("stays unfinished mid-window", () => {
    expect(
      isBookFinished({ isLastPageOfWindow: false, loadedEndChar: 120000, totalChars: 120000 }),
    ).toBe(false);
  });

  // Preformatted books bake the whole text into the document and keep no model,
  // so there is no total to compare against and the window is the whole book.
  it("trusts the webview when the whole book is loaded and no total is known", () => {
    expect(isBookFinished({ isLastPageOfWindow: true, loadedEndChar: 0, totalChars: 0 })).toBe(
      true,
    );
  });
});
