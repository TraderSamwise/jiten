import type { WrappedUserDb } from "./user-db";

/** Soft-delete a row: set deleted_at and updated_at */
export async function softDelete(db: WrappedUserDb, table: string, where: string, params: any[]) {
  const now = new Date().toISOString();
  await db.runAsync(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${where}`, [
    now,
    now,
    ...params,
  ]);
}

/** Table config for mutable (last-write-wins) tables */
export const MUTABLE_TABLES = [
  { name: "lists", pk: "id", timestampCol: "updated_at", pushFilter: "is_default = 0" },
  {
    name: "list_entries",
    pk: "id",
    timestampCol: "updated_at",
    pushFilter: "list_id NOT LIKE 'default-%'",
  },
  { name: "srs_cards", pk: "id", timestampCol: "updated_at" },
  {
    name: "books",
    pk: "id",
    timestampCol: "updated_at",
    excludeCols: ["html_content", "raw_content"],
    // Synced once (push if remote missing, pull if local missing) — not on every delta cycle
    blobCols: { cols: ["raw_content"], filter: "is_default = 0" },
  },
  { name: "user_kanji_notes", pk: "literal", timestampCol: "updated_at" },
  { name: "confusion_pairs", pk: "id", timestampCol: "updated_at" },
  // app_flags removed — only contains local seeding flags, not user data
] as const;

/** Table config for append-only (INSERT OR IGNORE merge) tables */
export const APPEND_TABLES = [
  { name: "review_logs", pk: "id", timestampCol: "reviewed_at" },
  { name: "practice_events", pk: "id", timestampCol: "reviewed_at" },
  { name: "practice_sessions", pk: "id", timestampCol: "started_at" },
  { name: "confusion_events", pk: "id", timestampCol: "confused_at" },
  { name: "game_scores", pk: "id", timestampCol: "played_at" },
] as const;

/** Check if user has any meaningful local data (lists, cards, books, notes). */
export async function hasLocalData(db: WrappedUserDb): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
      (SELECT COUNT(*) FROM lists WHERE deleted_at IS NULL AND is_default = 0) +
      (SELECT COUNT(*) FROM srs_cards WHERE deleted_at IS NULL) +
      (SELECT COUNT(*) FROM books WHERE deleted_at IS NULL AND is_default = 0) +
      (SELECT COUNT(*) FROM user_kanji_notes WHERE deleted_at IS NULL) as n`,
  );
  return !!(row && row.n > 0);
}

/** Wipe all user data rows. Schema stays intact — sync pull repopulates from remote. */
export async function resetLocalUserData(db: WrappedUserDb) {
  const tables = [...MUTABLE_TABLES, ...APPEND_TABLES].map((t) => t.name);
  for (const table of tables) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
  await db.runAsync("DELETE FROM sync_meta");
  // Clear seeding flags so defaults re-create for the new user
  await db.runAsync("DELETE FROM app_flags");
}

/** Maps user-facing category keys to their underlying tables */
export const DATA_CATEGORIES: Record<
  string,
  { label: string; mutable: string[]; append: string[] }
> = {
  lists: { label: "Study Lists", mutable: ["lists", "list_entries"], append: [] },
  flashcards: { label: "Flashcards", mutable: ["srs_cards"], append: ["review_logs"] },
  books: { label: "Books", mutable: ["books"], append: [] },
  notes: { label: "Kanji Notes", mutable: ["user_kanji_notes"], append: [] },
  practice: {
    label: "Practice History",
    mutable: [],
    append: ["practice_events", "practice_sessions"],
  },
  games: { label: "Game Scores", mutable: [], append: ["game_scores"] },
  confusion: {
    label: "Confusion Data",
    mutable: ["confusion_pairs"],
    append: ["confusion_events"],
  },
};

/** Delete selected data categories locally (soft-delete mutable, hard-delete append) and remotely. */
export async function deleteSelectedData(
  db: WrappedUserDb,
  turso: import("@libsql/client/web").Client | null,
  categories: Set<string>,
): Promise<void> {
  const now = new Date().toISOString();

  for (const key of categories) {
    const cat = DATA_CATEGORIES[key];
    if (!cat) continue;

    // Soft-delete mutable tables (syncs via updated_at)
    for (const table of cat.mutable) {
      await db.runAsync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL`,
        [now, now],
      );
    }

    // Hard-delete append tables locally
    for (const table of cat.append) {
      await db.runAsync(`DELETE FROM ${table}`);
    }

    // Hard-delete append tables remotely (can't sync deletions for append-only)
    if (turso) {
      for (const table of cat.append) {
        try {
          await turso.execute(`DELETE FROM ${table}`);
        } catch (e) {
          console.warn(`[DeleteData] Remote delete ${table} failed:`, e);
        }
      }
    }
  }

  // Clear seeding flags so defaults can re-create if user wants
  if (categories.has("lists")) {
    await db.runAsync(
      `DELETE FROM app_flags WHERE key IN ('default_lists_seeded_v3', 'default_vocab_lists_seeded_v2', 'rtk_lessons_seeded')`,
    );
  }
}
