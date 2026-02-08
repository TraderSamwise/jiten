import React, { createContext, useContext, useEffect, useState } from "react";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";

interface UserDbContextType {
  userDb: WrappedUserDb | null;
  isReady: boolean;
}

const UserDbContext = createContext<UserDbContextType>({
  userDb: null,
  isReady: false,
});

export function useUserDb(): WrappedUserDb | null {
  const { userDb } = useContext(UserDbContext);
  return userDb;
}

const USER_DB_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS list_entries (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL,
    added_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS srs_cards (
    id TEXT PRIMARY KEY,
    entry_id INTEGER NOT NULL,
    list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    state INTEGER NOT NULL,
    last_review TEXT,
    front_mode TEXT NOT NULL DEFAULT 'kanji',
    back_mode TEXT NOT NULL DEFAULT 'english',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    state INTEGER NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_srs_cards_due ON srs_cards(due)`,
  `CREATE INDEX IF NOT EXISTS idx_srs_cards_state ON srs_cards(state)`,
  `CREATE INDEX IF NOT EXISTS idx_srs_cards_list ON srs_cards(list_id)`,
  `CREATE INDEX IF NOT EXISTS idx_list_entries_list ON list_entries(list_id)`,
  `CREATE INDEX IF NOT EXISTS idx_review_logs_card ON review_logs(card_id)`,
];

export function UserDatabaseProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<UserDbContextType>({
    userDb: null,
    isReady: false,
  });

  useEffect(() => {
    async function init() {
      const db = await SQLite.openDatabaseAsync("user.db");
      await db.execAsync("PRAGMA journal_mode = MEMORY");
      await db.execAsync("PRAGMA temp_store = MEMORY");

      for (const sql of USER_DB_MIGRATIONS) {
        await db.execAsync(sql);
      }

      const wrapped: WrappedUserDb = {
        getAllAsync: <T,>(sql: string, params?: any[]): Promise<T[]> =>
          db.getAllAsync<T>(sql, params ?? []),

        getFirstAsync: <T,>(
          sql: string,
          params?: any[]
        ): Promise<T | null> => db.getFirstAsync<T>(sql, params ?? []),

        runAsync: async (sql: string, params?: any[]) => {
          const result = await db.runAsync(sql, params ?? []);
          return {
            changes: result.changes,
            lastInsertRowId: result.lastInsertRowId,
          };
        },

        sync: () => {},
      };

      setState({ userDb: wrapped, isReady: true });
      console.log("[UserDB Web] Initialized successfully");
    }

    init().catch((err) => {
      console.error("[UserDB Web] Init error:", err);
      setState({ userDb: null, isReady: true });
    });
  }, [userId]);

  return (
    <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>
  );
}
