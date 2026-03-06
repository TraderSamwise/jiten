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
  { name: "lists", pk: "id", timestampCol: "updated_at" },
  { name: "list_entries", pk: "id", timestampCol: "updated_at" },
  { name: "srs_cards", pk: "id", timestampCol: "updated_at" },
  {
    name: "books",
    pk: "id",
    timestampCol: "updated_at",
    excludeCols: ["html_content"],
  },
  { name: "user_kanji_notes", pk: "literal", timestampCol: "updated_at" },
  { name: "confusion_pairs", pk: "id", timestampCol: "updated_at" },
  { name: "app_flags", pk: "key", timestampCol: "updated_at" },
] as const;

/** Table config for append-only (INSERT OR IGNORE merge) tables */
export const APPEND_TABLES = [
  { name: "review_logs", pk: "id", timestampCol: "reviewed_at" },
  { name: "practice_events", pk: "id", timestampCol: "reviewed_at" },
  { name: "practice_sessions", pk: "id", timestampCol: "started_at" },
  { name: "confusion_events", pk: "id", timestampCol: "confused_at" },
  { name: "game_scores", pk: "id", timestampCol: "played_at" },
] as const;
