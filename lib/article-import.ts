import type { WrappedUserDb } from "@/db/user-db";

export interface ArticleData {
  title: string;
  content: string;
  url: string;
  byline: string;
  imageUrl: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Import a web article into the books table.
 * Returns the new book ID.
 */
export async function importArticle(userDb: WrappedUserDb, article: ArticleData): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();

  await userDb.runAsync(
    `INSERT INTO books (id, title, author, source, source_url, image_url, raw_content, created_at, updated_at)
     VALUES (?, ?, ?, 'article', ?, ?, ?, ?, ?)`,
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

  return id;
}
