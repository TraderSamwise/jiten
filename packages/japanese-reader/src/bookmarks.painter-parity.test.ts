/**
 * @vitest-environment jsdom
 *
 * `paintedBookmarkSpans` exists so that a tap can ask where the reader
 * actually painted, and it is a second copy of the webview's `findMatches`:
 * the webview is standalone by design — no dependencies, bundled into the
 * page — so the two cannot share code. This pins them to the same answer.
 */

import { describe, expect, it } from "vitest";

import { type BookmarkRunPlacements, bookmarksInsideSpan, paintedBookmarkSpans } from "./bookmarks";

import { state } from "@tradersamwise/jiten-reader-webview/src/state";
import {
  resetBookmarkHighlightState,
  setBookmarkHighlights,
} from "@tradersamwise/jiten-reader-webview/src/bookmarks";

/** Paint with the device's painter and read back where the boxes landed. */
function paintedByTheDevice(
  text: string,
  placements: BookmarkRunPlacements[],
): { start: number; text: string }[] {
  const page = document.createElement("div");
  page.innerHTML = `<p>${text}</p>`;
  document.body.replaceChildren(page);
  state.pageEl = page;
  state.contentEl = page;
  resetBookmarkHighlightState();
  setBookmarkHighlights({ version: `${Math.random()}`, runs: placements });

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

const CASES: { name: string; text: string; placements: BookmarkRunPlacements[] }[] = [
  {
    name: "a span inside a run that starts further back",
    text: "助手席に座る。",
    placements: [{ run: "助手席に座る", spans: [[0, 3]] }],
  },
  {
    name: "two spans in one run",
    text: "ネットでおいしい店を調べる。",
    placements: [
      {
        run: "ネットでおいしい店を調べる",
        spans: [
          [4, 2],
          [9, 2],
        ],
      },
    ],
  },
  {
    name: "a run that is only part of the text",
    text: "十数年にわたる、結婚生活。",
    placements: [{ run: "結婚生活", spans: [[0, 2]] }],
  },
  {
    name: "the same run twice",
    text: "ここでも。ここでも。",
    placements: [{ run: "ここでも", spans: [[0, 2]] }],
  },
  {
    name: "a run the text does not contain",
    text: "何も光らない。",
    placements: [{ run: "存在しない", spans: [[0, 5]] }],
  },
  { name: "nothing placed", text: "短い文。", placements: [] },
  {
    name: "a span past the end of its run",
    text: "短い文。",
    placements: [{ run: "短い文", spans: [[1, 9]] }],
  },
  {
    name: "a zero-length span",
    text: "短い文。",
    placements: [{ run: "短い文", spans: [[0, 0]] }],
  },
];

describe("paintedBookmarkSpans agrees with the webview painter", () => {
  for (const { name, text, placements } of CASES) {
    it(name, () => {
      const mine = paintedBookmarkSpans(text, placements).map((span) => ({
        start: span.start,
        text: span.surface,
      }));
      expect(mine).toEqual(paintedByTheDevice(text, placements));
    });
  }
});

describe("bookmarksInsideSpan", () => {
  const provenance = new Map([
    ["励み", [{ entryId: 1557390, word: "励む", reasons: ["masu-stem"], via: "kanji" as const }]],
    ["流し", [{ entryId: 1552100, word: "流し", reasons: [], via: "kanji" as const }]],
  ]);

  const placements: BookmarkRunPlacements[] = [{ run: "毎朝励み", spans: [[2, 2]] }];

  it("names the bookmarked word inside a tapped span", () => {
    // The page says 励み, the tap answers the noun 励み, the bookmark is 励む.
    expect(bookmarksInsideSpan("毎朝励み、", 2, 4, provenance, placements)).toEqual([
      { surface: "励み", word: "励む", reasons: ["masu-stem"], entryIds: [1557390] },
    ]);
  });

  it("ignores a bookmark that falls outside the span", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 2, provenance, placements)).toEqual([]);
  });

  it("ignores a bookmark the span only partly covers", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 3, provenance, placements)).toEqual([]);
  });

  it("has nothing to say when nothing is bookmarked", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 0, 5, new Map(), placements)).toEqual([]);
  });

  /** The surface is bookmarked, but not painted at this place on the page. */
  it("has nothing to say where nothing was placed", () => {
    expect(bookmarksInsideSpan("毎朝励み、", 2, 4, provenance, [])).toEqual([]);
  });
});
