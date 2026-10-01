/**
 * @vitest-environment jsdom
 *
 * A pinned reading has to reach the page, and the page has to repaint when it
 * changes. Both are easy to get wrong in ways no unit test of the renderer can
 * see: pins that never reach `applyFuriganaToHtml`, or a slice cache keyed
 * without them that keeps serving the reading the page used to have.
 */
import Database from "better-sqlite3";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
}));

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import type { JapaneseReaderBackend, ReaderBookSource, ReaderSqlDb } from "./backend";
import type { ReaderBookRecord, ReaderFuriganaPins } from "./types";
import { useJapaneseReader, type JapaneseReaderSettings } from "./use-japanese-reader";

const PAGE = "杏子は帰った。";

const NO_LEVELS = { n5: false, n4: false, n3: false, n2: false, n1: false, nonJouyou: false };

/** Every furigana rule off, so anything that appears can only be a pin. */
const SETTINGS: JapaneseReaderSettings = {
  pageAnimations: false,
  sourceFuriganaEnabled: false,
  readerCounterFurigana: false,
  readerNameFurigana: false,
  readerBookmarkHighlights: false,
  furiganaRuleLevels: {
    matchAnyKanji: { ...NO_LEVELS },
    matchWordLevel: { ...NO_LEVELS },
    matchIrregularReading: { ...NO_LEVELS },
    matchMostlyKunyomi: { ...NO_LEVELS },
    matchMostlyOnyomi: { ...NO_LEVELS },
    matchMixedOnKun: { ...NO_LEVELS },
  },
};

const SETTINGS_ACTIONS = {
  setPageAnimations: () => {},
  setSourceFuriganaEnabled: () => {},
  setReaderCounterFurigana: () => {},
  setReaderNameFurigana: () => {},
  setReaderBookmarkHighlights: () => {},
  setFuriganaRuleLevels: () => {},
};

/** The app's port, backed by a plain map instead of SQLite. */
function fakePins(initial: Record<string, string> = {}): ReaderFuriganaPins & {
  rows: Map<string, string>;
} {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    list: async () => new Map(rows),
    set: async (_bookId, surface, reading) => {
      rows.set(surface, reading);
    },
    clear: async (_bookId, surface) => {
      rows.delete(surface);
    },
    clearAll: async () => {
      rows.clear();
    },
  };
}

const describeWithDb = hasDictDb ? describe : describe.skip;

describeWithDb("useJapaneseReader furigana pins", () => {
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
  // Auto-cleanup is not on here, and a hook left mounted keeps re-rendering
  // while the next test waits for its own first render.
  afterEach(cleanup);

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

  /**
   * A repaint of an open book does not change `html` — the whole document is
   * built once and the new content is posted into the webview. So the spy on
   * `postMessage` is the only place the second render is visible.
   */
  const render = (furiganaPins: ReaderFuriganaPins) => {
    const backend: JapaneseReaderBackend = { dictDb, extendedDb: null, furiganaPins };
    const posted: string[] = [];
    const hook = renderHook(() =>
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
    hook.result.current.readerViewRef.current = {
      postMessage: (message: string) => posted.push(message),
      injectJavaScript: () => {},
    } as never;
    const posted_ = () => posted.map((message) => JSON.parse(message) as { type: string });
    const reloadedContent = () => {
      for (const message of [...posted].reverse()) {
        const parsed = JSON.parse(message) as { type: string; html?: string };
        if (parsed.type === "reloadContent") return parsed.html ?? "";
      }
      return null;
    };
    return { ...hook, reloadedContent, posted: posted_ };
  };

  test("paints a reading that was already pinned when the book opened", async () => {
    const { result } = render(fakePins({ 杏子: "きょうこ" }));
    await waitFor(() => expect(result.current.html).not.toBeNull());
    expect(result.current.html).toContain("<ruby>杏子<rt>きょうこ</rt></ruby>");
  });

  test("shows no furigana at all when nothing is pinned", async () => {
    const { result } = render(fakePins());
    await waitFor(() => expect(result.current.html).not.toBeNull());
    // Narrow on purpose: `html` is the whole reader document, and the webview
    // bundle inlined in it contains the word ruby.
    expect(result.current.html).not.toContain("<ruby>杏子");
  });

  /** The page has already been rendered once; it has to be rendered again. */
  test("repaints when a reading is pinned while the book is open", async () => {
    const pins = fakePins();
    const { result, reloadedContent } = render(pins);
    await waitFor(() => expect(result.current.html).not.toBeNull());
    expect(result.current.html).not.toContain("きょうこ");

    await act(async () => {
      await result.current.setFuriganaPin("杏子", "きょうこ");
    });

    await waitFor(() => expect(reloadedContent()).toContain("きょうこ"));
    expect(pins.rows.get("杏子")).toBe("きょうこ");
  });

  test("repaints when a reading is unpinned", async () => {
    const pins = fakePins({ 杏子: "きょうこ" });
    const { result, reloadedContent } = render(pins);
    await waitFor(() => expect(result.current.html).toContain("きょうこ"));

    await act(async () => {
      await result.current.clearFuriganaPin("杏子");
    });

    await waitFor(() => expect(reloadedContent()).not.toBeNull());
    expect(reloadedContent()).not.toContain("きょうこ");
    expect(pins.rows.has("杏子")).toBe(false);
  });

  test("clears every pin of the book at once", async () => {
    const pins = fakePins({ 杏子: "きょうこ", 帰: "かえ" });
    const { result, reloadedContent } = render(pins);
    await waitFor(() => expect(result.current.html).toContain("きょうこ"));

    await act(async () => {
      await result.current.clearAllFuriganaPins();
    });

    await waitFor(() => expect(reloadedContent()).not.toBeNull());
    expect(reloadedContent()).not.toContain("<ruby>");
    expect(pins.rows.size).toBe(0);
  });

  /**
   * The line height, the `furigana-active` class and how many characters fit on
   * a page all follow one flag. A page laid out as if it had no ruby clips the
   * ruby it does have, so a single pin has to set it.
   */
  test("lays the page out for ruby when the only ruby is a pin", async () => {
    const { result } = render(fakePins({ 杏子: "きょうこ" }));
    await waitFor(() => expect(result.current.html).not.toBeNull());
    // The class name appears in the stylesheet either way; the page element is
    // where it says something.
    expect(result.current.html).toContain('<div id="page" class="furigana-active">');

    const { result: bare } = render(fakePins());
    await waitFor(() => expect(bare.current.html).not.toBeNull());
    expect(bare.current.html).toContain('<div id="page">');
  });

  /**
   * The reader only extracts surfaces from kanji, and from a digit followed by
   * one. A pin on a bare digit therefore sits on a page with no surface at all
   * — the one case where the resolver has nothing to say and the pin still has
   * to be painted. The key is the fullwidth ３ because the reader converts
   * ASCII digits as it lays the page out, so that is what a press reports.
   */
  test("paints a pin on a page the dictionary finds nothing in", async () => {
    const kanaPage = "ひらがなと3。";
    const { result } = renderHook(() =>
      useJapaneseReader({
        bookId: "b3",
        bookSource: {
          loadBook: async () => ({
            ...book,
            id: "b3",
            rawContent: kanaPage,
            totalChars: kanaPage.length,
          }),
          saveProgress: async () => {},
        },
        backend: {
          dictDb,
          extendedDb: null,
          furiganaPins: fakePins({ "３": "さん" }),
        },
        // Names on, so the reader builds a kanji set and takes its dictionary
        // path — which is where a slice with no surface in it has to keep the
        // pin rather than skip the whole pass.
        settings: { ...SETTINGS, readerNameFurigana: true },
        settingsActions: SETTINGS_ACTIONS,
        isDark: true,
      }),
    );
    await waitFor(() => expect(result.current.html).not.toBeNull());
    expect(result.current.html).toContain("<ruby>３<rt>さん</rt></ruby>");
  });

  /**
   * The matcher reads ahead by the length of the longest surface, which is ten
   * characters. A pin can be longer — a source ruby over a whole title — and
   * one that could not be read that far would silently never fire.
   */
  test("paints a pin longer than the longest dictionary surface", async () => {
    const longRun = "大日本帝国憲法第九十八条";
    const longPage = `${longRun}について。`;
    const { result } = renderHook(() =>
      useJapaneseReader({
        bookId: "b4",
        bookSource: {
          loadBook: async () => ({
            ...book,
            id: "b4",
            rawContent: longPage,
            totalChars: longPage.length,
          }),
          saveProgress: async () => {},
        },
        backend: {
          dictDb,
          extendedDb: null,
          furiganaPins: fakePins({ [longRun]: "だいにっぽんていこくけんぽうだいきゅうじょう" }),
        },
        settings: SETTINGS,
        settingsActions: SETTINGS_ACTIONS,
        isDark: true,
      }),
    );
    await waitFor(() => expect(result.current.html).not.toBeNull());
    expect(result.current.html).toContain(
      `<ruby>${longRun}<rt>だいにっぽんていこくけんぽうだいきゅうじょう</rt></ruby>`,
    );
  });

  /**
   * The long press reaches the hook as a message, like a tap does. The sheet
   * opens before the dictionaries have answered — half a second of holding a
   * finger down has to show something — and fills in after.
   */
  test("a long press opens the sheet at once and fills it in", async () => {
    const { result } = render(fakePins({ 杏子: "きょうこ" }));
    await waitFor(() => expect(result.current.readerViewProps).not.toBeNull());

    await act(async () => {
      await result.current.readerViewProps!.onMessage(
        JSON.stringify({ type: "furiganaPin", run: "杏子", currentReading: "きょうこ" }),
      );
    });

    expect(result.current.furiganaPinTarget?.run).toBe("杏子");
    expect(result.current.furiganaPinTarget?.pinnedReading).toBe("きょうこ");
    await waitFor(() => expect(result.current.furiganaPinTarget?.candidates).not.toBeNull());
    expect(result.current.furiganaPinTarget!.candidates!.map((c) => c.reading)).toContain("あんず");
  });

  /**
   * The press paints the run it is asking about, in the reader's own highlight
   * colour. Nothing in the webview clears it, so closing the sheet has to — or
   * the page keeps a purple block over a word nobody is looking at.
   */
  test("closing the sheet forgets what it was asking about, and unpaints it", async () => {
    const { result, posted } = render(fakePins());
    await waitFor(() => expect(result.current.readerViewProps).not.toBeNull());
    await act(async () => {
      await result.current.readerViewProps!.onMessage(
        JSON.stringify({ type: "furiganaPin", run: "杏子", currentReading: "" }),
      );
    });
    expect(result.current.furiganaPinTarget).not.toBeNull();

    act(() => result.current.closeFuriganaPinSheet());
    expect(result.current.furiganaPinTarget).toBeNull();
    expect(posted().map((message) => message.type)).toContain("clearHighlight");
  });

  test("a long press on something with no run says nothing", async () => {
    const { result } = render(fakePins());
    await waitFor(() => expect(result.current.readerViewProps).not.toBeNull());
    await act(async () => {
      await result.current.readerViewProps!.onMessage(
        JSON.stringify({ type: "furiganaPin", run: "", currentReading: "" }),
      );
    });
    expect(result.current.furiganaPinTarget).toBeNull();
  });

  /**
   * The page is repainted as soon as a write returns, so a write that failed
   * must not return. Showing a reading nothing remembers is worse than showing
   * none: it looks saved until the next reload.
   */
  test("leaves the page alone when the reading could not be stored", async () => {
    const pins = fakePins();
    const failing: ReaderFuriganaPins = {
      ...pins,
      set: async () => {
        throw new Error("disk full");
      },
    };
    const { result } = render(failing);
    await waitFor(() => expect(result.current.html).not.toBeNull());

    await act(async () => {
      await expect(result.current.setFuriganaPin("杏子", "きょうこ")).rejects.toThrow("disk full");
    });

    expect(result.current.furiganaPins.has("杏子")).toBe(false);
  });

  /**
   * The screen stays mounted when the book changes. A sheet still asking about
   * a run in the book before it would write the next choice to this one.
   */
  test("forgets the sheet and the pins when the book changes", async () => {
    const pins = fakePins({ 杏子: "きょうこ" });
    const other = "ちがう本の文。";
    let currentBookId = "b1";
    const { result, rerender } = renderHook(
      ({ bookId }: { bookId: string }) =>
        useJapaneseReader({
          bookId,
          bookSource: {
            loadBook: async (id) =>
              id === "b1" ? book : { ...book, id, rawContent: other, totalChars: other.length },
            saveProgress: async () => {},
          },
          backend: { dictDb, extendedDb: null, furiganaPins: pins },
          settings: SETTINGS,
          settingsActions: SETTINGS_ACTIONS,
          isDark: true,
        }),
      { initialProps: { bookId: currentBookId } },
    );
    await waitFor(() => expect(result.current.html).toContain("きょうこ"));
    await act(async () => {
      await result.current.readerViewProps!.onMessage(
        JSON.stringify({ type: "furiganaPin", run: "杏子", currentReading: "きょうこ" }),
      );
    });
    expect(result.current.furiganaPinTarget).not.toBeNull();

    currentBookId = "b9";
    rerender({ bookId: currentBookId });
    expect(result.current.furiganaPinTarget).toBeNull();
  });

  test("does nothing, rather than throwing, with no pin store behind it", async () => {
    const backend: JapaneseReaderBackend = { dictDb, extendedDb: null };
    const { result } = renderHook(() =>
      useJapaneseReader({
        bookId: "b1",
        bookSource,
        backend,
        settings: SETTINGS,
        settingsActions: SETTINGS_ACTIONS,
        isDark: true,
      }),
    );
    await waitFor(() => expect(result.current.html).not.toBeNull());
    await act(async () => {
      await result.current.setFuriganaPin("杏子", "きょうこ");
    });
    expect(result.current.html).not.toContain("きょうこ");
  });
});
