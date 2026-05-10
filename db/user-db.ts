import type { DB, QueryResult } from "@op-engineering/op-sqlite";
import { notifyDbError } from "@/components/GlobalErrorHandler";
import { isClosedUserDbConnectionError } from "./db-errors";

/**
 * Wraps op-sqlite's DB to match the expo-sqlite API our screens already use.
 * This lets us swap the underlying driver without changing any screen code.
 */
export interface WrappedUserDb {
  getAllAsync: <T>(sql: string, params?: any[]) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: any[]) => Promise<T | null>;
  runAsync: (sql: string, params?: any[]) => Promise<{ changes: number; lastInsertRowId: number }>;
  sync: () => void;
}

interface WrapUserDbOptions {
  shouldNotifyError?: (err: unknown) => boolean;
}

function shouldNotifyDbError(err: unknown, options?: WrapUserDbOptions): boolean {
  if (isClosedUserDbConnectionError(err)) return false;
  return options?.shouldNotifyError ? options.shouldNotifyError(err) : true;
}

export function wrapUserDb(db: DB, options?: WrapUserDbOptions): WrappedUserDb {
  return {
    getAllAsync: async <T>(sql: string, params?: any[]): Promise<T[]> => {
      try {
        const result: QueryResult = await db.execute(sql, params);
        return result.rows as T[];
      } catch (err) {
        console.error("[UserDB] getAllAsync FAILED:", String(err), "\n  SQL:", sql.slice(0, 200));
        if (shouldNotifyDbError(err, options)) notifyDbError(err, sql);
        throw err;
      }
    },

    getFirstAsync: async <T>(sql: string, params?: any[]): Promise<T | null> => {
      try {
        const result: QueryResult = await db.execute(sql, params);
        return (result.rows[0] as T) ?? null;
      } catch (err) {
        console.error("[UserDB] getFirstAsync FAILED:", String(err), "\n  SQL:", sql.slice(0, 200));
        if (shouldNotifyDbError(err, options)) notifyDbError(err, sql);
        throw err;
      }
    },

    runAsync: async (sql: string, params?: any[]) => {
      try {
        const result: QueryResult = await db.execute(sql, params);
        return {
          changes: result.rowsAffected,
          lastInsertRowId: result.insertId ?? 0,
        };
      } catch (err) {
        console.error("[UserDB] runAsync FAILED:", String(err), "\n  SQL:", sql.slice(0, 200));
        if (shouldNotifyDbError(err, options)) notifyDbError(err, sql);
        throw err;
      }
    },

    sync: () => db.sync(),
  };
}
