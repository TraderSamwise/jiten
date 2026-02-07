import type { DB, QueryResult } from "@op-engineering/op-sqlite";

/**
 * Wraps op-sqlite's DB to match the expo-sqlite API our screens already use.
 * This lets us swap the underlying driver without changing any screen code.
 */
export interface WrappedUserDb {
  getAllAsync: <T>(sql: string, params?: any[]) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: any[]) => Promise<T | null>;
  runAsync: (
    sql: string,
    params?: any[]
  ) => Promise<{ changes: number; lastInsertRowId: number }>;
  sync: () => void;
}

export function wrapUserDb(db: DB): WrappedUserDb {
  return {
    getAllAsync: async <T>(sql: string, params?: any[]): Promise<T[]> => {
      const result: QueryResult = await db.execute(sql, params);
      return result.rows as T[];
    },

    getFirstAsync: async <T>(
      sql: string,
      params?: any[]
    ): Promise<T | null> => {
      const result: QueryResult = await db.execute(sql, params);
      return (result.rows[0] as T) ?? null;
    },

    runAsync: async (sql: string, params?: any[]) => {
      const result: QueryResult = await db.execute(sql, params);
      return {
        changes: result.rowsAffected,
        lastInsertRowId: result.insertId ?? 0,
      };
    },

    sync: () => db.sync(),
  };
}
