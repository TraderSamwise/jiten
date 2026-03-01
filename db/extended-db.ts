/**
 * Extended dictionary database — created locally on device,
 * populated progressively from downloaded JSONL data.
 *
 * Contains: synonyms, names (JMnedict)
 * Progress tracked in ext_meta table for resumability.
 */

import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

const EXT_DB_NAME = "dictionary-extended.db";

/**
 * Open (or create) the local extended database.
 * On web, acquires OPFS lock first.
 */
export async function openExtendedDb(): Promise<SQLite.SQLiteDatabase> {
  if (Platform.OS === "web") {
    const { ensureLockAvailable } = await import("./web-lock");
    await ensureLockAvailable();
  }
  const db = await SQLite.openDatabaseAsync(EXT_DB_NAME);
  await createExtendedSchema(db);
  return db;
}

/** Create tables if they don't exist. */
async function createExtendedSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ext_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS synonyms (
      word TEXT NOT NULL,
      synonym TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS names (
      id INTEGER PRIMARY KEY,
      kanji TEXT,
      kana TEXT NOT NULL,
      name_type TEXT,
      translation TEXT
    );
  `);
}

/** Check if a dataset has been fully imported at the given version. */
export async function isDatasetReady(
  db: SQLite.SQLiteDatabase,
  datasetKey: string,
  version: number,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM ext_meta WHERE key = ?",
    [`${datasetKey}_version`],
  );
  return row !== null && parseInt(row.value, 10) >= version;
}

/** Get the number of rows already imported for a dataset. */
export async function getImportProgress(
  db: SQLite.SQLiteDatabase,
  datasetKey: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM ext_meta WHERE key = ?",
    [`${datasetKey}_rows_imported`],
  );
  return row ? parseInt(row.value, 10) : 0;
}

/** Get the stored version for a dataset. */
export async function getDatasetVersion(
  db: SQLite.SQLiteDatabase,
  datasetKey: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM ext_meta WHERE key = ?",
    [`${datasetKey}_version`],
  );
  return row ? parseInt(row.value, 10) : 0;
}

/** Reset a dataset (truncate table and clear progress). */
export async function resetDataset(db: SQLite.SQLiteDatabase, datasetKey: string): Promise<void> {
  await db.execAsync(`DELETE FROM ${datasetKey}`);
  await db.runAsync("DELETE FROM ext_meta WHERE key LIKE ?", [`${datasetKey}_%`]);
  // Drop indexes (they'll be recreated after import)
  if (datasetKey === "synonyms") {
    await db.execAsync("DROP INDEX IF EXISTS idx_ext_synonyms_word");
    await db.execAsync("DROP INDEX IF EXISTS idx_ext_synonyms_synonym");
  } else if (datasetKey === "names") {
    await db.execAsync("DROP INDEX IF EXISTS idx_ext_names_kanji");
    await db.execAsync("DROP INDEX IF EXISTS idx_ext_names_kana");
  }
}

/** Build indexes after a dataset is fully imported. */
export async function buildIndexes(db: SQLite.SQLiteDatabase, datasetKey: string): Promise<void> {
  if (datasetKey === "synonyms") {
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_ext_synonyms_word ON synonyms(word)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_ext_synonyms_synonym ON synonyms(synonym)");
  } else if (datasetKey === "names") {
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_ext_names_kanji ON names(kanji)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_ext_names_kana ON names(kana)");
  }
}
