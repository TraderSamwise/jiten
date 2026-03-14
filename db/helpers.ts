import { isNull } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/** Generate a short unique ID (same format used across all user DB tables). */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/** Returns an `isNull(table.deletedAt)` filter for soft-delete queries. */
export function notDeleted(deletedAtColumn: SQLiteColumn) {
  return isNull(deletedAtColumn);
}

/** Returns createdAt + updatedAt fields set to the current ISO timestamp. */
export function withTimestamps() {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
}

/** Returns updatedAt + deletedAt fields for a soft-delete operation. */
export function withSoftDelete() {
  const now = new Date().toISOString();
  return { deletedAt: now, updatedAt: now };
}
