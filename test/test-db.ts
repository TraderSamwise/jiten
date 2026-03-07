/**
 * In-memory SQLite database for testing.
 * Uses better-sqlite3 to provide a real SQLite engine that implements
 * the WrappedUserDb interface, so tests exercise actual SQL queries.
 */
import Database from "better-sqlite3";
import { USER_DB_MIGRATIONS } from "@/db/user-migrations";
import type { WrappedUserDb } from "@/db/user-db";

export function createTestDb(): WrappedUserDb & { close: () => void } {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run all migrations
  for (const sql of USER_DB_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      // Ignore "duplicate column" errors from ALTER TABLE ADD COLUMN
      // (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
      if (err.message?.includes("duplicate column")) continue;
      throw err;
    }
  }

  return {
    getAllAsync: async <T>(sql: string, params?: any[]): Promise<T[]> => {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },

    getFirstAsync: async <T>(sql: string, params?: any[]): Promise<T | null> => {
      const stmt = db.prepare(sql);
      return ((params ? stmt.get(...params) : stmt.get()) as T) ?? null;
    },

    runAsync: async (sql: string, params?: any[]) => {
      const stmt = db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },

    sync: () => {},

    close: () => db.close(),
  };
}
