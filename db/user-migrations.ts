/**
 * User DB migrations — shared between native/web providers and the sync engine.
 * Both user-provider.native.tsx and user-provider.web.tsx import this array.
 */
export const USER_DB_MIGRATIONS = [
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
  `ALTER TABLE practice_events ADD COLUMN session_id TEXT`,
  `CREATE TABLE IF NOT EXISTS practice_sessions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, list_id TEXT, practice_mode TEXT NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, total_items INTEGER NOT NULL, correct_count INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_practice_sessions_list ON practice_sessions(list_id)`,
  `CREATE INDEX IF NOT EXISTS idx_practice_sessions_date ON practice_sessions(started_at)`,
  // Re-seed default lists: delete stale defaults and clear flags so seedDefaultListsIfNeeded re-creates them
  `DELETE FROM srs_cards WHERE list_id IN (SELECT id FROM lists WHERE is_default = 1)`,
  `DELETE FROM lists WHERE is_default = 1`,
  `DELETE FROM app_flags WHERE key IN ('default_lists_seeded', 'default_vocab_lists_seeded', 'rtk_lessons_seeded')`,
  `ALTER TABLE practice_events ADD COLUMN assisted INTEGER DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS confusion_events (
    id TEXT PRIMARY KEY,
    entry_id_a INTEGER NOT NULL,
    kanji_literal_a TEXT,
    entry_id_b INTEGER NOT NULL,
    kanji_literal_b TEXT,
    confusion_type TEXT NOT NULL,
    list_id TEXT,
    practice_mode TEXT,
    confused_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_confusion_events_date ON confusion_events(confused_at)`,
  `ALTER TABLE books ADD COLUMN char_offset INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE books ADD COLUMN total_chars INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS game_scores (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, game_type TEXT NOT NULL, game_mode TEXT NOT NULL, speed_preset TEXT NOT NULL, score INTEGER NOT NULL, matches_made INTEGER NOT NULL, triples_made INTEGER NOT NULL, max_combo INTEGER NOT NULL, accuracy INTEGER NOT NULL, duration_ms INTEGER NOT NULL, played_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_game_scores_list ON game_scores(list_id, game_type)`,
  // --- Cloud sync schema migrations ---
  // Add updated_at to tables missing it
  `ALTER TABLE list_entries ADD COLUMN updated_at TEXT DEFAULT NULL`,
  `ALTER TABLE app_flags ADD COLUMN updated_at TEXT DEFAULT NULL`,
  `ALTER TABLE confusion_pairs ADD COLUMN updated_at TEXT DEFAULT NULL`,
  // Backfill updated_at
  `UPDATE list_entries SET updated_at = added_at WHERE updated_at IS NULL`,
  `UPDATE app_flags SET updated_at = datetime('now') WHERE updated_at IS NULL`,
  `UPDATE confusion_pairs SET updated_at = last_confused_at WHERE updated_at IS NULL`,
  // Add deleted_at to mutable tables
  `ALTER TABLE lists ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  `ALTER TABLE list_entries ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  `ALTER TABLE srs_cards ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  `ALTER TABLE books ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  `ALTER TABLE user_kanji_notes ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  `ALTER TABLE confusion_pairs ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  // Sync tracking table
  `CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Delta query indexes
  `CREATE INDEX IF NOT EXISTS idx_lists_updated ON lists(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_list_entries_updated ON list_entries(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_srs_cards_updated ON srs_cards(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at)`,
  // Clean up orphaned list_entries from non-idempotent migration re-runs (FKs off → no cascade)
  `DELETE FROM list_entries WHERE list_id NOT IN (SELECT id FROM lists)`,
  // Review marks table for "Mark for Review" feature
  `CREATE TABLE IF NOT EXISTS review_marks (
    id TEXT PRIMARY KEY,
    entry_id INTEGER NOT NULL,
    kanji_literal TEXT DEFAULT NULL,
    list_id TEXT DEFAULT NULL,
    marked_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_marks_date ON review_marks(marked_at)`,
  `CREATE INDEX IF NOT EXISTS idx_review_marks_entry_day ON review_marks(entry_id, kanji_literal, marked_at)`,
  `ALTER TABLE books ADD COLUMN saved INTEGER NOT NULL DEFAULT 1`,
  // Learning steps for FSRS
  `ALTER TABLE lists ADD COLUMN learning_steps TEXT DEFAULT NULL`,
  `ALTER TABLE lists ADD COLUMN relearning_steps TEXT DEFAULT NULL`,
  `ALTER TABLE srs_cards ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE books ADD COLUMN source_url TEXT DEFAULT NULL`,
  `ALTER TABLE books ADD COLUMN image_url TEXT DEFAULT NULL`,
  `ALTER TABLE books ADD COLUMN read_complete INTEGER NOT NULL DEFAULT 0`,
  // Personal primitive↔word co-occurrence index for the semantic auto-linker.
  // Local-only + rebuildable from user_kanji_notes, so it is NOT synced.
  `CREATE TABLE IF NOT EXISTS primitive_note_assoc (
    literal TEXT NOT NULL,
    word TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (literal, word, target)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pna_word ON primitive_note_assoc(word)`,
  // Explicit per-list ordering. Preserves import/insertion order instead of
  // relying on added_at (which the list view was showing reversed). ALTER runs
  // on the remote too; the backfill UPDATE SQL is not replayed remotely (sync
  // filters UPDATEs) — each device computes the same ranks (added_at then id)
  // locally and the bumped updated_at delta-syncs the values. Index is local.
  `ALTER TABLE list_entries ADD COLUMN position INTEGER`,
  `UPDATE list_entries SET position = (
     SELECT COUNT(*) FROM list_entries AS le2
     WHERE le2.list_id = list_entries.list_id
       AND (le2.added_at < list_entries.added_at
            OR (le2.added_at = list_entries.added_at AND le2.id < list_entries.id))
   ), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE position IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_list_entries_list_position ON list_entries(list_id, position)`,
];
