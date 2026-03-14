import { sql } from "drizzle-orm";
import { books } from "@/db/schema";
import { generateId } from "@/db/helpers";
import type { UserDrizzle } from "@/db/drizzle";

export interface ArticleData {
  title: string;
  content: string;
  url: string;
  byline: string;
  imageUrl: string;
}

const MAX_UNSAVED = 10;

/**
 * Import a web article into the books table (as unsaved/recent).
 * Caps unsaved articles to MAX_UNSAVED, deleting oldest beyond the limit.
 * Returns the new book ID.
 */
export async function importArticle(db: UserDrizzle, article: ArticleData): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .insert(books)
    .values({
      id,
      title: article.title || "Untitled Article",
      author: article.byline || "",
      source: "article",
      sourceUrl: article.url,
      imageUrl: article.imageUrl || null,
      rawContent: article.content,
      saved: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // Evict oldest unsaved articles beyond the cap
  await db.run(
    sql`DELETE FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article'
     AND id NOT IN (SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source = 'article' ORDER BY created_at DESC LIMIT ${MAX_UNSAVED})`,
  );

  return id;
}
