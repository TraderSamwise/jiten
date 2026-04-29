import type { ReaderBookRecord, ReaderBookSource } from "@jiten/japanese-reader";

function parseReaderBookRow(row: any): ReaderBookRecord {
  return {
    id: row.id,
    title: row.title,
    source: row.source ?? "import",
    rawContent: row.raw_content ?? null,
    scrollPosition: row.scroll_position ?? 0,
    charOffset: row.char_offset ?? 0,
    totalChars: row.total_chars ?? 0,
    fontSize: row.font_size ?? 22,
    readComplete: !!row.read_complete,
    saved: row.saved ?? 1,
  };
}

export function createJitenReaderBookSource(
  userDb: {
    getFirstAsync<T = any>(sql: string, params?: any): Promise<T | null>;
    runAsync(sql: string, params?: any): Promise<unknown>;
  },
  markDirty: () => void,
): ReaderBookSource {
  return {
    async loadBook(bookId) {
      const row = await userDb.getFirstAsync<any>("SELECT * FROM books WHERE id = ?", [bookId]);
      return row ? parseReaderBookRow(row) : null;
    },
    async saveProgress({ bookId, charOffset, totalChars, readComplete }) {
      await userDb.runAsync(
        "UPDATE books SET char_offset = ?, total_chars = COALESCE(?, total_chars), read_complete = ?, updated_at = ? WHERE id = ?",
        [charOffset, totalChars ?? null, readComplete ? 1 : 0, new Date().toISOString(), bookId],
      );
      markDirty();
    },
    async savePreferences({ bookId, fontSize }) {
      if (fontSize == null) return;
      await userDb.runAsync("UPDATE books SET font_size = ?, updated_at = ? WHERE id = ?", [
        fontSize,
        new Date().toISOString(),
        bookId,
      ]);
      markDirty();
    },
    async markOpened(bookId) {
      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE books SET last_read_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        bookId,
      ]);
      markDirty();
    },
  };
}
