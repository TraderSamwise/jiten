import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import { getUserDrizzle } from "@/db/drizzle";
import type { UserDrizzle } from "@/db/drizzle";
import { importArticle } from "./article-import";
import type { WrappedUserDb } from "@/db/user-db";
import type { ArticleData } from "./article-import";

let rawDb: WrappedUserDb & { close: () => void };
let db: UserDrizzle;

beforeEach(() => {
  if (rawDb) rawDb.close();
  rawDb = createTestDb();
  db = getUserDrizzle(rawDb);
});

afterAll(() => {
  if (rawDb) rawDb.close();
});

function makeArticle(overrides: Partial<ArticleData> = {}): ArticleData {
  return {
    title: "Test Article",
    content: "<p>Some content</p>",
    url: "https://example.com/article",
    byline: "Author Name",
    imageUrl: "https://example.com/image.jpg",
    ...overrides,
  };
}

// ─── importArticle ───

describe("importArticle", () => {
  test("inserts a book record and returns an ID", async () => {
    const id = await importArticle(db, makeArticle());

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    const row = await rawDb.getFirstAsync<{ title: string; source: string; saved: number }>(
      "SELECT title, source, saved FROM books WHERE id = ?",
      [id],
    );
    expect(row).toMatchObject({
      title: "Test Article",
      source: "article",
      saved: 0,
    });
  });

  test("stores article fields correctly", async () => {
    const id = await importArticle(
      db,
      makeArticle({
        title: "Japanese Grammar",
        content: "<p>Grammar guide</p>",
        url: "https://example.com/grammar",
        byline: "Sensei",
        imageUrl: "https://example.com/grammar.jpg",
      }),
    );

    const row = await rawDb.getFirstAsync<{
      title: string;
      author: string;
      source_url: string;
      image_url: string;
      raw_content: string;
    }>("SELECT title, author, source_url, image_url, raw_content FROM books WHERE id = ?", [id]);

    expect(row).toMatchObject({
      title: "Japanese Grammar",
      author: "Sensei",
      source_url: "https://example.com/grammar",
      image_url: "https://example.com/grammar.jpg",
      raw_content: "<p>Grammar guide</p>",
    });
  });

  test("uses 'Untitled Article' when title is empty", async () => {
    const id = await importArticle(db, makeArticle({ title: "" }));

    const row = await rawDb.getFirstAsync<{ title: string }>(
      "SELECT title FROM books WHERE id = ?",
      [id],
    );
    expect(row?.title).toBe("Untitled Article");
  });

  test("generates unique IDs for each import", async () => {
    const id1 = await importArticle(db, makeArticle({ url: "https://example.com/1" }));
    const id2 = await importArticle(db, makeArticle({ url: "https://example.com/2" }));

    expect(id1).not.toBe(id2);
  });
});

// ─── Eviction ───

describe("eviction of old unsaved articles", () => {
  test("keeps at most 10 unsaved articles", async () => {
    // Import 12 articles
    for (let i = 0; i < 12; i++) {
      await importArticle(db, makeArticle({ url: `https://example.com/${i}` }));
    }

    const rows = await rawDb.getAllAsync<{ id: string }>(
      "SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article'",
    );
    expect(rows).toHaveLength(10);
  });

  test("evicts oldest unsaved articles first", async () => {
    // Insert articles with known timestamps by inserting directly
    for (let i = 0; i < 12; i++) {
      const ts = new Date(2025, 0, i + 1).toISOString();
      await rawDb.runAsync(
        `INSERT INTO books (id, title, author, source, source_url, raw_content, saved, created_at, updated_at) VALUES (?, ?, '', 'article', ?, 'content', 0, ?, ?)`,
        [`art-${i}`, `Article ${i}`, `https://example.com/${i}`, ts, ts],
      );
    }

    // Importing one more triggers eviction
    await importArticle(db, makeArticle({ url: "https://example.com/new" }));

    const rows = await rawDb.getAllAsync<{ id: string }>(
      "SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article' ORDER BY created_at ASC",
    );
    expect(rows).toHaveLength(10);
    // The 3 oldest (art-0, art-1, art-2) should be gone since we had 12 + 1 = 13, keep 10
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("art-0");
    expect(ids).not.toContain("art-1");
    expect(ids).not.toContain("art-2");
  });

  test("does not evict saved articles", async () => {
    // Mark one as saved
    const ts = new Date(2025, 0, 1).toISOString();
    await rawDb.runAsync(
      `INSERT INTO books (id, title, author, source, source_url, raw_content, saved, created_at, updated_at) VALUES (?, ?, '', 'article', ?, 'content', 1, ?, ?)`,
      ["saved-art", "Saved Article", "https://example.com/saved", ts, ts],
    );

    // Import 11 unsaved articles (triggers eviction to keep 10)
    for (let i = 0; i < 11; i++) {
      await importArticle(db, makeArticle({ url: `https://example.com/${i}` }));
    }

    // Saved article should still exist
    const saved = await rawDb.getFirstAsync<{ id: string }>(
      "SELECT id FROM books WHERE id = 'saved-art'",
    );
    expect(saved).toBeTruthy();
  });
});
