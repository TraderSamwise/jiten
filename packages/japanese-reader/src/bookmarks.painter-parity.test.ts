/**
 * @vitest-environment jsdom
 *
 * `paintedBookmarkSpans` exists so that a tap can ask where the reader
 * actually painted, and it is a second copy of the webview's `findMatches`:
 * the webview is standalone by design — no dependencies, bundled into the
 * page — so the two cannot share code. This pins them to the same answer.
 */

import { describe, expect, it } from "vitest";

import { bookmarksInsideSpan, paintedBookmarkSpans } from "./bookmarks";

import { state } from "@tradersamwise/jiten-reader-webview/src/state";
import {
  resetBookmarkHighlightState,
  setBookmarkHighlights,
} from "@tradersamwise/jiten-reader-webview/src/bookmarks";

/** Paint with the device's painter and read back where the boxes landed. */
function paintedByTheDevice(text: string, surfaces: string[]): { start: number; text: string }[] {
  const page = document.createElement("div");
  page.innerHTML = `<p>${text}</p>`;
  document.body.replaceChildren(page);
  state.pageEl = page;
  state.contentEl = page;
  resetBookmarkHighlightState();
  setBookmarkHighlights({ version: `${Math.random()}`, surfaces });

  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const spans: { start: number; text: string }[] = [];
  let at = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const chunk = node.textContent ?? "";
    if (chunk.length === 0) continue;
    const parent = node.parentNode as Element | null;
    if (parent?.classList?.contains("bookmarked-word")) spans.push({ start: at, text: chunk });
    at += chunk.length;
  }
  return spans;
}

const CASES: { text: string; surfaces: string[] }[] = [
  // Longest first, so 助手席 wins over 助手 at the same position.
  { text: "助手席に座る。", surfaces: ["助手", "助手席"] },
  // Non-overlapping: once おい is taken, い is not available to start しい.
  { text: "ネットでおいしい店を調べる。", surfaces: ["おい", "しい", "いし"] },
  // A surface that only appears inside a longer one is never painted.
  { text: "十数年にわたる結婚生活。", surfaces: ["数", "十数年", "わた"] },
  // Repeats.
  { text: "ここでもここでも。", surfaces: ["ここ", "でも"] },
  // Nothing matches.
  { text: "何も光らない。", surfaces: ["存在しない"] },
  // The empty surface must not wedge the scan.
  { text: "短い文。", surfaces: ["", "短い"] },
];

describe("paintedBookmarkSpans agrees with the webview painter", () => {
  for (const { text, surfaces } of CASES) {
    it(`${text} with [${surfaces.join(", ")}]`, () => {
      const mine = paintedBookmarkSpans(text, surfaces).map((span) => ({
        start: span.start,
        text: span.surface,
      }));
      expect(mine).toEqual(paintedByTheDevice(text, surfaces));
    });
  }
});

describe("bookmarksInsideSpan", () => {
  const provenance = new Map([
    ["励み", [{ entryId: 1557390, word: "励む", reasons: ["masu-stem"], via: "kanji" as const }]],
    ["流し", [{ entryId: 1552100, word: "流し", reasons: [], via: "kanji" as const }]],
  ]);

  it("names the bookmarked word inside a tapped span", () => {
    // The page says 励み, the tap answers the noun 励み, the bookmark is 励む.
    expect(bookmarksInsideSpan("毎朝励み、", 2, 4, provenance)).toEqual([
      { surface: "励み", word: "励む", reasons: ["masu-stem"], entryIds: [1557390] },
    ]);
  });

  it("ignores a bookmark that falls outside the span", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 2, provenance)).toEqual([]);
  });

  it("ignores a bookmark the span only partly covers", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 3, provenance)).toEqual([]);
  });

  it("has nothing to say when nothing is bookmarked", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 5, new Map())).toEqual([]);
  });
});
