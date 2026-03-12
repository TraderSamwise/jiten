import type { WrappedUserDb } from "@/db/user-db";

export interface ArticleData {
  title: string;
  content: string;
  url: string;
  byline: string;
  imageUrl: string;
}

const MAX_UNSAVED = 10;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Import a web article into the books table (as unsaved/recent).
 * Caps unsaved articles to MAX_UNSAVED, deleting oldest beyond the limit.
 * Returns the new book ID.
 */
export async function importArticle(userDb: WrappedUserDb, article: ArticleData): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();

  await userDb.runAsync(
    `INSERT OR IGNORE INTO books (id, title, author, source, source_url, image_url, raw_content, saved, created_at, updated_at)
     VALUES (?, ?, ?, 'article', ?, ?, ?, 0, ?, ?)`,
    [
      id,
      article.title || "Untitled Article",
      article.byline || "",
      article.url,
      article.imageUrl || null,
      article.content,
      now,
      now,
    ],
  );

  // Evict oldest unsaved articles beyond the cap
  await userDb.runAsync(
    `DELETE FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article'
     AND id NOT IN (SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article' ORDER BY created_at DESC LIMIT ?)`,
    [MAX_UNSAVED],
  );

  return id;
}
