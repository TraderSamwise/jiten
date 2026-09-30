import { describe, expect, it } from "vitest";

import { applyBookmarkHighlightsToHtml, resolveBookmarkedWordSurfacesInHtml } from "./bookmarks";

function createBookmarkTestDb() {
  const kanjiRows = [
    { text: "殻", entry_id: 1 },
    { text: "林", entry_id: 2 },
  ];
  const kanaRows = [
    { text: "から", entry_id: 1 },
    { text: "はやし", entry_id: 2 },
    { text: "のみ", entry_id: 3 },
  ];

  return {
    async getAllAsync<T>(sql: string, params?: any[]): Promise<T[]> {
      if (sql.includes("SELECT text, entry_id FROM kanji WHERE text IN")) {
        return kanjiRows.filter((row) => params?.includes(row.text)) as T[];
      }
      if (sql.includes("SELECT text, entry_id FROM kana WHERE text IN")) {
        return kanaRows.filter((row) => params?.includes(row.text)) as T[];
      }
      if (sql.includes("SELECT DISTINCT entry_id FROM kanji WHERE entry_id IN")) {
        return [...new Set(kanjiRows.map((row) => row.entry_id))]
          .filter((entryId) => params?.includes(entryId))
          .map((entry_id) => ({ entry_id })) as T[];
      }
      throw new Error(`Unexpected SQL in bookmark test db: ${sql}`);
    },
    async getFirstAsync<T>(): Promise<T | null> {
      return null;
    },
  };
}

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

  it("does not highlight kana forms for bookmarked entries that have kanji forms", async () => {
    const html = "<p>殻が落ちたから、のみ飲んだ。</p>";
    const db = createBookmarkTestDb();
    const bookmarks = {
      version: "test",
      hasEntryId(entryId: number) {
        return entryId === 1 || entryId === 3;
      },
    };

    const surfaces = await resolveBookmarkedWordSurfacesInHtml(db, html, bookmarks);

    expect(surfaces.has("殻")).toBe(true);
    expect(surfaces.has("から")).toBe(false);
    expect(surfaces.has("のみ")).toBe(true);
  });
});

/**
 * A bookmark saved while reading is almost always saved from an inflected form
 * — you tap the text in front of you — and the highlighter only ever matched
 * spellings literally, so 縁がある never lit up 縁があったら and やり込める never
 * lit up やりこめてい.
 */
describe("resolveBookmarkedWordSurfacesInHtml, inflected", () => {
  const db = {
    async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const kanji = [
        { text: "縁がある", entry_id: 10 },
        { text: "やり込める", entry_id: 11 },
        { text: "事", entry_id: 12 },
      ];
      const kana = [
        { text: "えんがある", entry_id: 10 },
        { text: "やりこめる", entry_id: 11 },
        { text: "こと", entry_id: 12 },
      ];
      if (sql.includes("FROM kanji WHERE text IN"))
        return kanji.filter((row) => params?.includes(row.text)) as T[];
      if (sql.includes("FROM kana WHERE text IN"))
        return kana.filter((row) => params?.includes(row.text)) as T[];
      if (sql.includes("SELECT DISTINCT entry_id FROM kanji WHERE entry_id IN"))
        return [...new Set(kanji.map((row) => row.entry_id))]
          .filter((id) => params?.includes(id))
          .map((entry_id) => ({ entry_id })) as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getFirstAsync<T>(): Promise<T | null> {
      return null;
    },
  };
  const bookmarked = (...ids: number[]) => ({
    version: "test",
    size: ids.length,
    hasEntryId: (id: number) => ids.includes(id),
  });

  it("finds the page's inflected form for a bookmarked entry", async () => {
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>どうせもう縁があったら、その時は</p>",
      bookmarked(10),
    );
    expect([...surfaces]).toContain("縁があったら");
  });

  it("follows an entry written in kana on the page", async () => {
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>相手をやりこめていく痛快さ</p>",
      bookmarked(11),
    );
    expect([...surfaces]).toContain("やりこめてい");
  });

  it("still finds the plain dictionary form", async () => {
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>縁がある人だ</p>",
      bookmarked(10),
    );
    expect([...surfaces]).toContain("縁がある");
  });

  /**
   * A bare kana reading of a bookmarked kanji word is not evidence — 事 would
   * light up every こと on the page. Only an undone inflection is.
   */
  it("does not light up a bare kana reading of a kanji entry", async () => {
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>そんなことはない</p>",
      bookmarked(12),
    );
    expect([...surfaces]).not.toContain("こと");
  });

  /**
   * Deinflecting against every list at once marks 57% of a slice instead of
   * 29%, so past a few thousand entries the page is better off literal.
   */
  it("stops deinflecting once the bookmarked set is too big to stay readable", async () => {
    const huge = { version: "v", size: 12000, hasEntryId: (id: number) => id === 10 };
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>どうせもう縁があったら、その時は</p>",
      huge,
    );
    expect([...surfaces]).not.toContain("縁があったら");
  });

  it("stays literal when the caller does not say how big the set is", async () => {
    const unsized = { version: "v", hasEntryId: (id: number) => id === 10 };
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>どうせもう縁があったら、その時は</p>",
      unsized,
    );
    expect([...surfaces]).not.toContain("縁があったら");
  });

  it("finds nothing when the entry is not bookmarked", async () => {
    const surfaces = await resolveBookmarkedWordSurfacesInHtml(
      db,
      "<p>どうせもう縁があったら</p>",
      bookmarked(99),
    );
    expect(surfaces.size).toBe(0);
  });
});
