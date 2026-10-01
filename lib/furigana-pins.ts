import type { WrappedUserDb } from "@/db/user-db";
import { softDelete } from "@/db/sync-helpers";

/**
 * Readings the reader pins over a kanji run, for one book.
 *
 * The key is the run as the page spells it — what the user long-pressed — not a
 * dictionary entry: an entry id cannot say "show no furigana here", cannot hold
 * a reading no entry carries, and is not what was pressed. The empty reading is
 * that suppression, and is a pin like any other.
 */

/** U+001F, a unit separator — not a character any book or reading contains. */
const KEY_SEPARATOR = "";

/**
 * The row id, derived from the key rather than generated.
 *
 * Two devices pinning the same run would otherwise write two rows, and
 * last-write-wins has nothing to collapse them with.
 */
export function pinId(bookId: string, surface: string): string {
  return `${bookId}${KEY_SEPARATOR}${surface}`;
}

function assertKey(bookId: string, surface: string): void {
  if (surface.length === 0) throw new Error("a furigana pin needs a surface");
  if (bookId.includes(KEY_SEPARATOR) || surface.includes(KEY_SEPARATOR)) {
    throw new Error("a furigana pin key cannot contain U+001F");
  }
}

/** Every live pin of a book, as surface → reading. */
export async function listPins(db: WrappedUserDb, bookId: string): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ surface: string; reading: string }>(
    "SELECT surface, reading FROM furigana_pins WHERE book_id = ? AND deleted_at IS NULL",
    [bookId],
  );
  return new Map(rows.map((row) => [row.surface, row.reading]));
}

/** Pin `reading` over `surface` in this book, replacing and reviving any earlier pin. */
export async function setPin(
  db: WrappedUserDb,
  bookId: string,
  surface: string,
  reading: string,
): Promise<void> {
  assertKey(bookId, surface);
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO furigana_pins (id, book_id, surface, reading, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL) " +
      "ON CONFLICT(id) DO UPDATE SET reading = excluded.reading, updated_at = excluded.updated_at, deleted_at = NULL",
    [pinId(bookId, surface), bookId, surface, reading, now, now],
  );
}

/** Remove one pin. Soft, so the removal reaches the other devices. */
export async function clearPin(db: WrappedUserDb, bookId: string, surface: string): Promise<void> {
  assertKey(bookId, surface);
  // The `deleted_at IS NULL` guard keeps a second removal from re-bumping a
  // tombstone that has already pushed.
  await softDelete(db, "furigana_pins", "id = ? AND deleted_at IS NULL", [pinId(bookId, surface)]);
}

/** Remove every pin of a book. */
export async function clearAllPins(db: WrappedUserDb, bookId: string): Promise<void> {
  await softDelete(db, "furigana_pins", "book_id = ? AND deleted_at IS NULL", [bookId]);
}
