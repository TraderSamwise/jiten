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
