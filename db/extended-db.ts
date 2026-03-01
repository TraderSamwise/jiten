/**
 * Extended dictionary database — pre-built and downloaded as a .db file.
 *
 * Contains: synonyms, names (JMnedict), with indexes pre-built.
 */

import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { loadWebExtendedDb } from "./dict-download";

const EXT_DB_NAME = "dictionary-extended.db";

/**
 * Open the extended database.
 * On native: opens the file directly (downloaded by extended-download).
 * On web: loads from IndexedDB and deserializes into memory.
 */
export async function openExtendedDb(): Promise<SQLite.SQLiteDatabase> {
  if (Platform.OS === "web") {
    const { ensureLockAvailable } = await import("./web-lock");
    await ensureLockAvailable();
    const db = await loadWebExtendedDb();
    if (!db) throw new Error("Extended data missing");
    return db;
  }
  return SQLite.openDatabaseAsync(EXT_DB_NAME);
}
