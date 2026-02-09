import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { openSync } from "@op-engineering/op-sqlite";
import type { DB } from "@op-engineering/op-sqlite";
import { wrapUserDb, type WrappedUserDb } from "./user-db";

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

/** Simple deterministic hash of userId to produce a valid Turso DB name */
function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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
  `ALTER TABLE lists ADD COLUMN flashcard_mode TEXT NOT NULL DEFAULT 'add_order'`,
  `ALTER TABLE lists ADD COLUMN front_faces TEXT NOT NULL DEFAULT '["kanji"]'`,
  `ALTER TABLE lists ADD COLUMN back_faces TEXT NOT NULL DEFAULT '["english"]'`,
  `ALTER TABLE lists ADD COLUMN study_position INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE lists ADD COLUMN configured INTEGER NOT NULL DEFAULT 0`,
  `UPDATE lists SET configured = 1`,
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    aozora_id INTEGER,
    source TEXT NOT NULL DEFAULT 'import',
    raw_content TEXT,
    html_content TEXT,
    scroll_position REAL NOT NULL DEFAULT 0,
    font_size INTEGER NOT NULL DEFAULT 22,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_read_at TEXT
  )`,
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
    let db: DB | null = null;
    let wrapped: WrappedUserDb | null = null;

    async function init() {
      const org = process.env.EXPO_PUBLIC_TURSO_ORG;
      const token = process.env.EXPO_PUBLIC_TURSO_GROUP_TOKEN;
      const dbName = hashUserId(userId);

      if (org && token) {
        // Synced mode — connect to Turso with local replica
        db = openSync({
          name: `user-${dbName}.db`,
          url: `libsql://${dbName}-${org}.turso.io`,
          authToken: token,
          libsqlSyncInterval: 60,
        });
      } else {
        // Local-only fallback (dev without Turso credentials)
        const { open } = await import("@op-engineering/op-sqlite");
        db = open({ name: "user.db" });
      }

      // Run migrations
      for (const sql of USER_DB_MIGRATIONS) {
        try {
          await db.execute(sql);
        } catch (err) {
          if (!String(err).includes("duplicate column")) throw err;
        }
      }

      wrapped = wrapUserDb(db);
      setState({ userDb: wrapped, isReady: true });
    }

    init().catch((err) => {
      console.error("[UserDB] Init error:", err);
      setState({ userDb: null, isReady: true });
    });

    return () => {
      if (db) {
        try {
          db.close();
        } catch {}
      }
    };
  }, [userId]);

  // Sync on app foreground
  useEffect(() => {
    if (!state.userDb) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        try {
          state.userDb!.sync();
        } catch (err) {
          console.warn("[UserDB] Foreground sync failed:", err);
        }
      }
    });

    return () => subscription.remove();
  }, [state.userDb]);

  return (
    <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>
  );
}
