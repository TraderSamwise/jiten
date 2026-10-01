/**
 * @vitest-environment jsdom
 *
 * The labelled bookmark-highlighting cases, run end to end: the real
 * dictionary, the real matcher, and the real painter the device uses.
 *
 * The painter matters. `applyBookmarkHighlightsToHtml` in this package is a
 * string painter that nothing in the app calls — the device ships the surface
 * set over postMessage and `packages/reader-webview/src/bookmarks.ts` paints
 * it into the DOM, with its own sort order and its own per-paragraph walk. A
 * fixture built on the string painter would measure the wrong thing.
 */

import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import {
  BOOKMARK_HIGHLIGHT_CASES,
  type HighlightCase,
} from "../../../test/fixtures/bookmark-highlight-cases";
import { resolveBookmarkedWordSurfacesInHtml } from "./bookmarks";

import { state } from "@tradersamwise/jiten-reader-webview/src/state";
import {
  resetBookmarkHighlightState,
  setBookmarkHighlights,
} from "@tradersamwise/jiten-reader-webview/src/bookmarks";

const db = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;

afterAll(() => db?.close());

const dictDb = {
  async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return db!.prepare(sql).all(...(params ?? [])) as T[];
  },
  async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
    return (db!.prepare(sql).get(...(params ?? [])) as T) ?? null;
  },
};

function ancestor(node: Node, test: (el: Element) => boolean): Element | null {
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeType === 1 && test(parent as Element)) return parent as Element;
    parent = parent.parentNode;
  }
  return null;
}

/**
 * What the reader actually shows. `spans` is one painted element each; `boxes`
 * merges spans with no unpainted character between them, because abutting
 * spans have no visible gap and read as a single highlight.
 */
function readPaintedText(root: Element): {
  spans: string[];
  boxes: string[];
  parts: { text: string; part: string }[];
} {
  const painted = Array.from(root.querySelectorAll("span.bookmarked-word"));
  const spans = painted.map((el) => el.textContent ?? "");
  // Which edges of a span carry the ring that parts two adjacent words.
  const parts = painted.map((el) => ({
    text: el.textContent ?? "",
    part:
      ["start", "middle", "end"].find((name) => el.classList.contains(`bookmarked-word-${name}`)) ??
      "only",
  }));

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const boxes: string[] = [];
  let current = "";
  let lastBlock: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (ancestor(node, (el) => el.tagName === "RT")) continue;
    const text = node.textContent ?? "";
    if (text.length === 0) continue;

    // Two paragraphs have no text node between them, so without this a span
    // ending one would fuse with one starting the next.
    const block = ancestor(node, (el) => el.tagName === "P");
    if (block !== lastBlock && current.length > 0) {
      boxes.push(current);
      current = "";
    }
    lastBlock = block;

    if (ancestor(node, (el) => el.classList.contains("bookmarked-word"))) {
      current += text;
    } else if (current.length > 0) {
      boxes.push(current);
      current = "";
    }
  }
  if (current.length > 0) boxes.push(current);

  return { spans, boxes, parts };
}

async function paint(testCase: HighlightCase): Promise<ReturnType<typeof readPaintedText>> {
  const html = testCase.html ?? `<p>${testCase.text}</p>`;
  const page = document.createElement("div");
  page.innerHTML = html;
  document.body.replaceChildren(page);
  state.pageEl = page;
  state.contentEl = page;

  const bookmarked = new Set(testCase.bookmarks);
  const surfaces = await resolveBookmarkedWordSurfacesInHtml(dictDb, html, {
    version: testCase.id,
    hasEntryId: (entryId) => bookmarked.has(entryId),
  });

  resetBookmarkHighlightState();
  setBookmarkHighlights({ version: testCase.id, surfaces: [...surfaces] });
  return readPaintedText(page);
}

describe.skipIf(!hasDictDb)("bookmark highlighting, labelled cases", () => {
  beforeEach(() => {
    state.pageEl = null;
    state.contentEl = null;
  });

  for (const testCase of BOOKMARK_HIGHLIGHT_CASES) {
    // An expectation the code does not meet yet runs as `it.fails`: green
    // while the bug stands, red the moment it is fixed. That is the prompt to
    // take the name out of `knownRed`, and it is why the fixture can be
    // committed before the repair.
    const red = new Set(testCase.knownRed ?? []);
    const check = (name: string) => (red.has(name) ? it.fails : it);

    describe(`finding ${testCase.id} — ${testCase.text}`, () => {
      for (const expected of testCase.mustHighlight) {
        check(expected)(`highlights ${expected}`, async () => {
          // A word split by its own ruby is several spans with no gap, which
          // the reader shows as one highlight — so either shape counts here.
          const { spans, boxes } = await paint(testCase);
          expect([...spans, ...boxes]).toContain(expected);
        });
      }

      for (const expected of testCase.mustHaveNoSeam ?? []) {
        check(expected)(`highlights ${expected} without a seam`, async () => {
          const { parts } = await paint(testCase);
          // The consecutive spans that together spell the word.
          const from = parts.findIndex((p) => expected.startsWith(p.text));
          expect(from).toBeGreaterThanOrEqual(0);
          let to = from;
          let spelled = "";
          while (to < parts.length && spelled.length < expected.length) {
            spelled += parts[to].text;
            to++;
          }
          expect(spelled).toBe(expected);

          const covering = parts.slice(from, to);
          const shape = covering.map((p) => p.part);
          // One span carries the whole ring; several carry it only on the
          // outside, so no edge of the ring falls inside the word.
          expect(shape).toEqual(
            covering.length === 1
              ? ["only"]
              : ["start", ...Array(covering.length - 2).fill("middle"), "end"],
          );
        });
      }

      for (const forbidden of testCase.mustNotHighlight) {
        check(forbidden)(`does not highlight ${forbidden}`, async () => {
          const { spans, boxes } = await paint(testCase);
          expect(spans).not.toContain(forbidden);
          expect(boxes).not.toContain(forbidden);
        });
      }
    });
  }
});
