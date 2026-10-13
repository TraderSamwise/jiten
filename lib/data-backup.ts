import type { WrappedUserDb } from "@/db/user-db";
import { LIST_POSITION_RANK } from "@/db/user-migrations";

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
      "SELECT id, name, description, flashcard_mode, front_faces, back_faces, study_position, configured, auto_play_audio, confusion_detection, voice_mode, typing_mode, disable_flip_animation, disable_swipe_animation, is_default, learning_steps, relearning_steps, mnemonic_cloze, new_per_session, created_at, updated_at FROM lists",
  },
  {
    name: "list_entries",
    query:
      "SELECT id, list_id, entry_id, kanji_literal, added_at, position, updated_at FROM list_entries",
  },
  {
    name: "srs_cards",
    query:
      "SELECT id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, front_mode, back_mode, simple_stage, simple_n, simple_interval, simple_relearning, simple_run, last_confusion_check, kanji_literal, learning_steps, created_at, updated_at FROM srs_cards",
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
  {
    name: "furigana_pins",
    query:
      "SELECT id, book_id, surface, reading, created_at, updated_at, deleted_at FROM furigana_pins",
  },
  {
    name: "user_kanji_notes",
    // `updated_at` or a restored mnemonic is invisible to the push, which
    // selects `WHERE updated_at > ?`.
    query: "SELECT literal, mnemonic, keyword, updated_at FROM user_kanji_notes",
  },
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
  {
    name: "course_progress",
    query:
      "SELECT id, course, unit, node, crown, first_seen_at, cracked_at, updated_at, deleted_at FROM course_progress",
  },
];

// Column names for each table — used for INSERT during import
/**
 * Where a table in `IMPORT_ORDER` has a primary key that is not `id`. A wrong
 * name makes `ON CONFLICT(pk)` throw, so this list is checked against the
 * schema by `lib/data-backup.test.ts`.
 */
/**
 * Columns a restore must supply if the backup did not, because the schema makes
 * them NOT NULL with no default. Checked against `PRAGMA table_info` by
 * `lib/data-backup.test.ts`.
 */
const REQUIRED_TIMESTAMPS: Record<string, string[]> = {
  user_kanji_notes: ["updated_at"],
};

/** When a restore stands in for a timestamp a backup never had. */
const RESTORE_TIMESTAMP = new Date(0).toISOString();

export const PRIMARY_KEYS: Record<string, string> = {
  user_kanji_notes: "literal",
};

export const TABLE_COLUMNS: Record<string, string[]> = {
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
    "mnemonic_cloze",
    "new_per_session",
    "created_at",
    "updated_at",
  ],
  list_entries: [
    "id",
    "list_id",
    "entry_id",
    "kanji_literal",
    "added_at",
    "position",
    "updated_at",
  ],
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
    "simple_relearning",
    "simple_run",
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
    "read_complete",
    "created_at",
    "updated_at",
  ],
  furigana_pins: ["id", "book_id", "surface", "reading", "created_at", "updated_at", "deleted_at"],
  user_kanji_notes: ["literal", "mnemonic", "keyword", "updated_at"],
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
  course_progress: [
    "id",
    "course",
    "unit",
    "node",
    "crown",
    "first_seen_at",
    "cracked_at",
    "updated_at",
    "deleted_at",
  ],
};

// Import order matters for FK constraints
export const IMPORT_ORDER = [
  "lists",
  "list_entries",
  "srs_cards",
  "review_logs",
  "practice_events",
  "confusion_pairs",
  "confusion_events",
  "books",
  "furigana_pins",
  "user_kanji_notes",
  "practice_sessions",
  "game_scores",
  "course_progress",
];

/** The columns a table actually has, or null if it cannot be read at all. */
export async function existingColumns(
  db: WrappedUserDb,
  tableName: string,
): Promise<Set<string> | null> {
  try {
    const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    if (!rows.length) return null;
    return new Set(rows.map((row) => row.name));
  } catch {
    return null;
  }
}

export async function attemptBackup(db: WrappedUserDb): Promise<BackupResult> {
  const result: BackupResult = { tables: {}, succeeded: [], failed: [] };
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await db.getAllAsync<any>(table.query);
      result.tables[table.name] = rows;
      result.succeeded.push(table.name);
    } catch (err) {
      // This runs on a database that failed to open or migrate, which is
      // exactly when a column the query names may not exist yet. Falling back
      // to the columns the table really has rescues the rows instead of
      // reporting the whole table as lost — a missing `new_per_session` used to
      // cost the user every list, and a missing `simple_relearning` every card.
      //
      // Only for a missing column. A locked, corrupt or absent table must stay
      // a failure: re-selecting fewer columns would report a clean rescue of
      // whatever came back, and the recovery screen would believe it.
      const cols = /no such column/i.test(String(err))
        ? await existingColumns(db, table.name)
        : null;
      const wanted = TABLE_COLUMNS[table.name];
      if (cols && wanted) {
        const usable = wanted.filter((col) => cols.has(col));
        try {
          const rows = await db.getAllAsync<any>(`SELECT ${usable.join(", ")} FROM ${table.name}`);
          result.tables[table.name] = rows;
          result.succeeded.push(table.name);
          continue;
        } catch (fallbackErr) {
          console.error(`[Recovery] Fallback backup of ${table.name} failed:`, fallbackErr);
        }
      }
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

    const allowed = TABLE_COLUMNS[tableName];
    if (!allowed) {
      result.skipped.push(tableName);
      continue;
    }

    // Only the columns this database actually has. A backup written by a newer
    // build names columns an older one lacks, and SQLite rejects the whole
    // statement for an unknown column — so one added column used to cost every
    // list and every flashcard in the restore, not just that column.
    const present = await existingColumns(db, tableName);
    const cols = present ? allowed.filter((col) => present.has(col)) : allowed;
    if (!cols.length) {
      result.skipped.push(tableName);
      continue;
    }

    onProgress?.(
      totalRowCount > 0 ? (processedRows / totalRowCount) * 100 : 0,
      `Importing ${tableName}...`,
    );

    // `INSERT OR REPLACE` is a DELETE followed by an INSERT, so restoring a
    // parent row fires every foreign-key cascade hanging off it: restoring
    // `lists` alone emptied `list_entries` and set `srs_cards.list_id` to NULL,
    // leaving the list with no words and its cards orphaned. An upsert touches
    // only the row named.
    const pk = PRIMARY_KEYS[tableName] ?? "id";
    const upsert = (columns: string[]) => {
      const assignments = columns
        .filter((col) => col !== pk)
        .map((col) => `${col} = excluded.${col}`)
        .join(", ");
      return `INSERT INTO ${tableName} (${columns.join(", ")})
        VALUES (${columns.map(() => "?").join(", ")})
        ON CONFLICT(${pk}) ${assignments ? `DO UPDATE SET ${assignments}` : "DO NOTHING"}`;
    };

    try {
      const sql = upsert(cols);
      const rowErrors: string[] = [];

      for (const row of rows) {
        // A row with no primary key would insert under a NULL one — SQLite
        // allows that in a TEXT PRIMARY KEY — and then poison sync, which keys
        // on it. Skip it rather than write it.
        if (row[pk] == null) {
          processedRows++;
          continue;
        }
        // A named NULL is written as NULL; an upsert does NOT fall back to the
        // column default. So a column the backup never had is left out of the
        // statement entirely, and takes its default.
        const named = cols.filter((col) => row[col] !== undefined);
        const values: unknown[] = named.map((col) => row[col] ?? null);

        // A timestamp a backup never carried is metadata, not the user's data,
        // and the schema requires it: `user_kanji_notes.updated_at` is NOT NULL
        // with no default, so every mnemonic in a pre-feature backup failed on
        // it. Supplying one restores the row; leaving it out loses the lot.
        for (const col of REQUIRED_TIMESTAMPS[tableName] ?? []) {
          if (cols.includes(col) && row[col] === undefined) {
            named.push(col);
            values.push(RESTORE_TIMESTAMP);
          }
        }
        try {
          await db.runAsync(named.length === cols.length ? sql : upsert(named), values);
        } catch (rowErr) {
          // A table can carry a unique index besides its primary key —
          // `confusion_pairs` does — and a row that collides on it raises an
          // error the pk's ON CONFLICT cannot absorb. Replacing that one row is
          // safe (nothing references it); aborting the table was not, because a
          // single colliding pair used to cost every row after it.
          if (/UNIQUE constraint failed/i.test(String(rowErr))) {
            await db.runAsync(
              `INSERT OR REPLACE INTO ${tableName} (${named.join(", ")})
               VALUES (${named.map(() => "?").join(", ")})`,
              values,
            );
          } else {
            // One bad row is not the table. Collect it and keep going, so a
            // truncated or hand-edited file costs that row and not the rest.
            rowErrors.push(String(rowErr));
          }
        }
        processedRows++;
      }

      // Every row failed, so the table did: report it as before, with the
      // first row's error rather than a wrapper around it.
      if (rowErrors.length === rows.length && rows.length > 0) {
        result.failed.push({ table: tableName, error: rowErrors[0] });
        continue;
      }
      if (rowErrors.length > 0) {
        console.warn(`[Import] ${rowErrors.length} row(s) of ${tableName} failed`, rowErrors[0]);
      }

      result.succeeded.push(tableName);
      result.totalRows += rows.length;
    } catch (err) {
      console.error(`[Import] Failed to import ${tableName}:`, err);
      result.failed.push({ table: tableName, error: String(err) });
      processedRows += rows.length;
    }
  }

  // Pre-feature backups have no position — assign one deterministically so
  // restored entries keep their added_at order instead of piling at the top.
  try {
    await db.runAsync(
      `UPDATE list_entries SET position = ${LIST_POSITION_RANK} WHERE position IS NULL`,
    );
  } catch (err) {
    console.error("[Import] Failed to backfill list_entries.position:", err);
  }

  onProgress?.(100, "Done");
  return result;
}
