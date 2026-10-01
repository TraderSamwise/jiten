/**
 * @vitest-environment jsdom
 *
 * Tapping a word is the reader's primary interaction, and it runs entirely
 * inside handleMessage. On 2026-09-28 the whole `tap` branch was deleted while
 * removing a diagnostic next to it: every tap opened the popup, ran no lookup,
 * and showed "No results" over the text it never searched. Nothing caught it —
 * the lookup functions were all still tested directly.
 */
import Database from "better-sqlite3";
import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
}));

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import type { JapaneseReaderBackend, ReaderSqlDb, ReaderBookSource } from "./backend";
import type { ReaderBookRecord } from "./types";
import { useJapaneseReader, type JapaneseReaderSettings } from "./use-japanese-reader";

const PAGE = "日本語の本を読む。";

const SETTINGS: JapaneseReaderSettings = {
  pageAnimations: false,
  sourceFuriganaEnabled: false,
  readerCounterFurigana: false,
  readerNameFurigana: false,
  readerBookmarkHighlights: false,
  furiganaRuleLevels: {} as JapaneseReaderSettings["furiganaRuleLevels"],
};

const SETTINGS_ACTIONS = {
  setPageAnimations: () => {},
  setSourceFuriganaEnabled: () => {},
  setReaderCounterFurigana: () => {},
  setReaderNameFurigana: () => {},
  setReaderBookmarkHighlights: () => {},
  setFuriganaRuleLevels: () => {},
};

const describeWithDb = hasDictDb ? describe : describe.skip;

describeWithDb("useJapaneseReader tap lookup", () => {
  let raw: Database.Database;
  let dictDb: ReaderSqlDb;

  beforeAll(() => {
    raw = new Database(DICT_DB_PATH, { readonly: true });
    dictDb = {
      getAllAsync: async <T,>(sql: string, params?: unknown[]) =>
        (params ? raw.prepare(sql).all(...(params as never[])) : raw.prepare(sql).all()) as T[],
      getFirstAsync: async <T,>(sql: string, params?: unknown[]) =>
        ((params ? raw.prepare(sql).get(...(params as never[])) : raw.prepare(sql).get()) as T) ??
        null,
    };
  });

  afterAll(() => raw.close());

  const book: ReaderBookRecord = {
    id: "b1",
    title: "t",
    source: "import",
    rawContent: PAGE,
    scrollPosition: 0,
    charOffset: 0,
    totalChars: PAGE.length,
    fontSize: 18,
  };

  const bookSource: ReaderBookSource = {
    loadBook: async () => book,
    saveProgress: async () => {},
  };

  const render = () => {
    const backend: JapaneseReaderBackend = { dictDb, extendedDb: null };
    return renderHook(() =>
      useJapaneseReader({
        bookId: "b1",
        bookSource,
        backend,
        settings: SETTINGS,
        settingsActions: SETTINGS_ACTIONS,
        isDark: true,
        initialLookupMode: "word",
      }),
    );
  };

  test("a tap message resolves the word under the offset", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.readerViewProps).not.toBeNull());

    // The webview sends a window of text plus where in it the finger landed.
    await result.current.readerViewProps!.onMessage(
      JSON.stringify({ type: "tap", text: PAGE, tapOffset: PAGE.indexOf("読") }),
    );

    await waitFor(() => expect(result.current.lookupResults.length).toBeGreaterThan(0));
    expect(result.current.lookupResults[0].matchedText).toBe("読む");
  });

  /**
   * Tapping takes the longest match and highlighting marks the smallest, so
   * the two name different words on the same characters. The page says 励み;
   * the tap answers 励み the noun (1557360); the bookmark is 励む the verb
   * (1557390). The lookup has to offer the second one, or the highlight and
   * the tap disagree about what is under the finger.
   */
  test("a tap offers the bookmarked word inside its own span", async () => {
    const bookmarkPage = "毎朝励み、体を動かす。";
    const bookmarked: ReaderBookRecord = {
      ...book,
      id: "b2",
      rawContent: bookmarkPage,
      totalChars: bookmarkPage.length,
    };
    const backend: JapaneseReaderBackend = {
      dictDb,
      extendedDb: null,
      bookmarks: { version: "v1", hasEntryId: (entryId) => entryId === 1557390 },
    };
    const { result } = renderHook(() =>
      useJapaneseReader({
        bookId: "b2",
        bookSource: { loadBook: async () => bookmarked, saveProgress: async () => {} },
        backend,
        settings: { ...SETTINGS, readerBookmarkHighlights: true },
        settingsActions: SETTINGS_ACTIONS,
        isDark: true,
        initialLookupMode: "word",
      }),
    );
    await waitFor(() => expect(result.current.readerViewProps).not.toBeNull());

    await result.current.readerViewProps!.onMessage(
      JSON.stringify({ type: "tap", text: bookmarkPage, tapOffset: bookmarkPage.indexOf("励") }),
    );

    await waitFor(() => expect(result.current.lookupResults.length).toBeGreaterThan(0));
    expect(result.current.lookupResults[0].matchedText).toBe("励み");
    await waitFor(() =>
      expect(result.current.lookupResults.map((r) => r.matchedText)).toContain("励む"),
    );
    const offered = result.current.lookupResults.find((r) => r.matchedText === "励む");
    expect(offered!.entries.map((entry) => entry.id)).toEqual([1557390]);
  });
});
