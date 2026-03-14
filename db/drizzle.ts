import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type { WrappedUserDb } from "./user-db";
import * as schema from "./schema";

export type UserDrizzle = SqliteRemoteDatabase<typeof schema>;

/**
 * Creates a typed Drizzle instance backed by a WrappedUserDb.
 * Uses the sqlite-proxy driver so Drizzle generates SQL and we
 * delegate execution to the existing WrappedUserDb methods.
 *
 * The Drizzle instance and raw WrappedUserDb coexist — you can
 * use either for any given query during the gradual migration.
 */
export function getUserDrizzle(userDb: WrappedUserDb): UserDrizzle {
  return drizzle(
    async (sql, params, method) => {
      if (method === "run") {
        await userDb.runAsync(sql, params);
        return { rows: [] };
      }

      // For 'all', 'get', 'values': execute the query and convert
      // object rows to arrays of values (sqlite-proxy contract).
      const rows = await userDb.getAllAsync<Record<string, unknown>>(sql, params);
      return {
        rows: rows.map((row) => Object.values(row)),
      };
    },
    { schema },
  );
}
