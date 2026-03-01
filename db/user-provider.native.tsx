import React, { createContext, useContext, useEffect, useState } from "react";
import { open } from "@op-engineering/op-sqlite";
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
  `ALTER TABLE books ADD COLUMN source_id TEXT`,
  `ALTER TABLE lists ADD COLUMN auto_play_audio INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE srs_cards ADD COLUMN simple_stage INTEGER DEFAULT NULL`,
  `ALTER TABLE srs_cards ADD COLUMN simple_n REAL DEFAULT NULL`,
  `ALTER TABLE srs_cards ADD COLUMN simple_interval REAL DEFAULT NULL`,
  `ALTER TABLE lists ADD COLUMN confusion_detection INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE srs_cards ADD COLUMN last_confusion_check TEXT DEFAULT NULL`,
  `ALTER TABLE lists ADD COLUMN voice_mode INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE lists ADD COLUMN typing_mode INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE lists ADD COLUMN disable_flip_animation INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE lists ADD COLUMN disable_swipe_animation INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE list_entries ADD COLUMN kanji_literal TEXT DEFAULT NULL`,
  `ALTER TABLE srs_cards ADD COLUMN kanji_literal TEXT DEFAULT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_list_entries_kanji ON list_entries(kanji_literal)`,
  `CREATE INDEX IF NOT EXISTS idx_srs_cards_kanji ON srs_cards(kanji_literal)`,
  `CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY, value TEXT)`,
  `ALTER TABLE lists ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
  `UPDATE lists SET is_default = 1 WHERE name IN ('JLPT N5 Kanji','JLPT N4 Kanji','JLPT N3 Kanji','JLPT N2 Kanji','JLPT N1 Kanji','Jouyou Grade 1','Jouyou Grade 2','Jouyou Grade 3','Jouyou Grade 4','Jouyou Grade 5','Jouyou Grade 6')`,
  `UPDATE lists SET is_default = 1 WHERE name IN ('JLPT N5 Words','JLPT N4 Words','JLPT N3 Words','JLPT N2 Words','JLPT N1 Words')`,
  `ALTER TABLE books ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS user_kanji_notes (literal TEXT PRIMARY KEY, mnemonic TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `ALTER TABLE user_kanji_notes ADD COLUMN keyword TEXT`,
  `CREATE TABLE IF NOT EXISTS practice_events (
    id TEXT PRIMARY KEY,
    entry_id INTEGER NOT NULL,
    kanji_literal TEXT,
    list_id TEXT,
    practice_mode TEXT NOT NULL,
    correct INTEGER NOT NULL,
    response_ms INTEGER,
    typed_answer TEXT,
    reviewed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_practice_events_entry ON practice_events(entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_practice_events_list ON practice_events(list_id)`,
  `CREATE INDEX IF NOT EXISTS idx_practice_events_date ON practice_events(reviewed_at)`,
  `CREATE TABLE IF NOT EXISTS confusion_pairs (
    id TEXT PRIMARY KEY,
    entry_id_a INTEGER NOT NULL,
    kanji_literal_a TEXT,
    entry_id_b INTEGER NOT NULL,
    kanji_literal_b TEXT,
    confusion_type TEXT NOT NULL,
    confusion_count INTEGER NOT NULL DEFAULT 1,
    last_confused_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_confusion_pairs_unique ON confusion_pairs(entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type)`,
  `CREATE INDEX IF NOT EXISTS idx_confusion_pairs_entry ON confusion_pairs(entry_id_a)`,
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

    async function init() {
      db = open({ name: "user.db" });

      // Run migrations
      for (const sql of USER_DB_MIGRATIONS) {
        try {
          await db.execute(sql);
        } catch (err) {
          if (!String(err).includes("duplicate column")) throw err;
        }
      }

      const wrapped = wrapUserDb(db);
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

  return <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>;
}
