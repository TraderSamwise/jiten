import type { WrappedUserDb } from "@/db/user-db";

export interface BackupResult {
  tables: Record<string, any[]>;
  succeeded: string[];
  failed: string[];
}

export interface ImportResult {
  succeeded: string[];
  failed: { table: string; error: string }[];
  skipped: string[];
  totalRows: number;
}

export const BACKUP_TABLES: {
  name: string;
  query: string;
}[] = [
  {
    name: "lists",
    query:
      "SELECT id, name, description, flashcard_mode, front_faces, back_faces, study_position, configured, auto_play_audio, confusion_detection, voice_mode, typing_mode, disable_flip_animation, disable_swipe_animation, is_default, learning_steps, relearning_steps, created_at, updated_at FROM lists",
  },
  {
    name: "list_entries",
    query: "SELECT id, list_id, entry_id, kanji_literal, added_at, updated_at FROM list_entries",
  },
  {
    name: "srs_cards",
    query:
      "SELECT id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, front_mode, back_mode, simple_stage, simple_n, simple_interval, last_confusion_check, kanji_literal, learning_steps, created_at, updated_at FROM srs_cards",
  },
  {
    name: "review_logs",
    query:
      "SELECT id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at FROM review_logs",
  },
  {
    name: "practice_events",
    query:
      "SELECT id, entry_id, kanji_literal, list_id, practice_mode, correct, response_ms, typed_answer, reviewed_at, session_id, assisted FROM practice_events",
  },
  {
    name: "confusion_pairs",
    query:
      "SELECT id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, confusion_count, last_confused_at, created_at, updated_at, deleted_at FROM confusion_pairs",
  },
  {
    name: "confusion_events",
    query:
      "SELECT id, entry_id_a, kanji_literal_a, entry_id_b, kanji_literal_b, confusion_type, list_id, practice_mode, confused_at FROM confusion_events",
  },
  {
    name: "books",
    query:
      "SELECT id, title, author, source, scroll_position, char_offset, total_chars, font_size, last_read_at, is_default, saved, read_complete, created_at, updated_at FROM books",
  },
  { name: "user_kanji_notes", query: "SELECT literal, mnemonic, keyword FROM user_kanji_notes" },
  {
    name: "practice_sessions",
    query:
      "SELECT id, session_id, list_id, practice_mode, started_at, duration_ms, total_items, correct_count FROM practice_sessions",
  },
  {
    name: "game_scores",
    query:
      "SELECT id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at FROM game_scores",
  },
];

// Column names for each table — used for INSERT during import
const TABLE_COLUMNS: Record<string, string[]> = {
  lists: [
    "id",
    "name",
    "description",
    "flashcard_mode",
    "front_faces",
    "back_faces",
    "study_position",
    "configured",
    "auto_play_audio",
    "confusion_detection",
    "voice_mode",
    "typing_mode",
    "disable_flip_animation",
    "disable_swipe_animation",
    "is_default",
    "learning_steps",
    "relearning_steps",
    "created_at",
    "updated_at",
  ],
  list_entries: ["id", "list_id", "entry_id", "kanji_literal", "added_at", "updated_at"],
  srs_cards: [
    "id",
    "entry_id",
    "list_id",
    "due",
    "stability",
    "difficulty",
    "elapsed_days",
    "scheduled_days",
    "reps",
    "lapses",
    "state",
    "last_review",
    "front_mode",
    "back_mode",
    "simple_stage",
    "simple_n",
    "simple_interval",
    "last_confusion_check",
    "kanji_literal",
    "learning_steps",
    "created_at",
    "updated_at",
  ],
  review_logs: [
    "id",
    "card_id",
    "rating",
    "state",
    "due",
    "stability",
    "difficulty",
    "elapsed_days",
    "scheduled_days",
    "reviewed_at",
  ],
  practice_events: [
    "id",
    "entry_id",
    "kanji_literal",
    "list_id",
    "practice_mode",
    "correct",
    "response_ms",
    "typed_answer",
    "reviewed_at",
    "session_id",
    "assisted",
  ],
  confusion_pairs: [
    "id",
    "entry_id_a",
    "kanji_literal_a",
    "entry_id_b",
    "kanji_literal_b",
    "confusion_type",
    "confusion_count",
    "last_confused_at",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  confusion_events: [
    "id",
    "entry_id_a",
    "kanji_literal_a",
    "entry_id_b",
    "kanji_literal_b",
    "confusion_type",
    "list_id",
    "practice_mode",
    "confused_at",
  ],
  books: [
    "id",
    "title",
    "author",
    "source",
    "scroll_position",
    "char_offset",
    "total_chars",
    "font_size",
    "last_read_at",
    "is_default",
    "saved",
    "created_at",
    "updated_at",
  ],
  user_kanji_notes: ["literal", "mnemonic", "keyword"],
  practice_sessions: [
    "id",
    "session_id",
    "list_id",
    "practice_mode",
    "started_at",
    "duration_ms",
    "total_items",
    "correct_count",
  ],
  game_scores: [
    "id",
    "list_id",
    "game_type",
    "game_mode",
    "speed_preset",
    "score",
    "matches_made",
    "triples_made",
    "max_combo",
    "accuracy",
    "duration_ms",
    "played_at",
  ],
};

// Import order matters for FK constraints
const IMPORT_ORDER = [
  "lists",
  "list_entries",
  "srs_cards",
  "review_logs",
  "practice_events",
  "confusion_pairs",
  "confusion_events",
  "books",
  "user_kanji_notes",
  "practice_sessions",
  "game_scores",
];

export async function attemptBackup(db: WrappedUserDb): Promise<BackupResult> {
  const result: BackupResult = { tables: {}, succeeded: [], failed: [] };
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await db.getAllAsync<any>(table.query);
      result.tables[table.name] = rows;
      result.succeeded.push(table.name);
    } catch (err) {
      console.error(`[Recovery] Failed to backup ${table.name}:`, err);
      result.failed.push(table.name);
    }
  }
  return result;
}

export async function importBackup(
  db: WrappedUserDb,
  jsonString: string,
  onProgress?: (percent: number, label: string) => void,
): Promise<ImportResult> {
  const data = JSON.parse(jsonString);

  if (!data.version || !data.tables) {
    throw new Error("Invalid backup file format");
  }

  // Count total rows across all tables for progress tracking
  let totalRowCount = 0;
  for (const tableName of IMPORT_ORDER) {
    const rows = data.tables[tableName];
    if (rows?.length) totalRowCount += rows.length;
  }

  const result: ImportResult = { succeeded: [], failed: [], skipped: [], totalRows: 0 };
  let processedRows = 0;

  for (const tableName of IMPORT_ORDER) {
    const rows = data.tables[tableName];
    if (!rows || rows.length === 0) {
      result.skipped.push(tableName);
      continue;
    }

    const cols = TABLE_COLUMNS[tableName];
    if (!cols) {
      result.skipped.push(tableName);
      continue;
    }

    onProgress?.(
      totalRowCount > 0 ? (processedRows / totalRowCount) * 100 : 0,
      `Importing ${tableName}...`,
    );

    try {
      const placeholders = cols.map(() => "?").join(", ");
      const sql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = cols.map((col) => row[col] ?? null);
        await db.runAsync(sql, values);
        processedRows++;
      }

      result.succeeded.push(tableName);
      result.totalRows += rows.length;
    } catch (err) {
      console.error(`[Import] Failed to import ${tableName}:`, err);
      result.failed.push({ table: tableName, error: String(err) });
      processedRows += rows.length;
    }
  }

  onProgress?.(100, "Done");
  return result;
}
