/**
 * Client-side dictionary migrations.
 *
 * These run on the user's device after downloading a base dictionary.db,
 * bridging the gap from DICT_BASE_VERSION to DICT_VERSION without requiring
 * a full re-download. Suitable for lightweight changes like ADD COLUMN
 * or small data updates.
 *
 * Each migration's SQL runs inside a transaction for atomicity.
 */

import type { SQLiteDatabase } from "expo-sqlite";

export interface ClientDictMigration {
  version: number;
  description: string;
  sql: string[];
}

/**
 * Add new migrations here when bumping DICT_VERSION ahead of DICT_BASE_VERSION.
 * Each entry must have a unique version number greater than DICT_BASE_VERSION.
 */
export const CLIENT_DICT_MIGRATIONS: ClientDictMigration[] = [
  // Example:
  // {
  //   version: 15,
  //   description: "Add heisig_lesson column to kanji table",
  //   sql: [
  //     "ALTER TABLE kanji ADD COLUMN heisig_lesson INTEGER",
  //   ],
  // },
];

/**
 * Run pending client-side migrations on the dict DB.
 *
 * @param db          expo-sqlite database handle
 * @param fromVersion current version stored in dict_meta (typically DICT_BASE_VERSION)
 * @param toVersion   target version (typically DICT_VERSION)
 * @returns           the final version reached after applying migrations
 */
export async function runClientDictMigrations(
  db: SQLiteDatabase,
  fromVersion: number,
  toVersion: number,
): Promise<number> {
  const pending = CLIENT_DICT_MIGRATIONS.filter(
    (m) => m.version > fromVersion && m.version <= toVersion,
  ).sort((a, b) => a.version - b.version);

  if (pending.length === 0) return fromVersion;

  console.log(
    `[DictMigrate] Applying ${pending.length} client migration(s): v${fromVersion} → v${toVersion}`,
  );

  let currentVersion = fromVersion;

  for (const migration of pending) {
    console.log(`[DictMigrate] v${migration.version}: ${migration.description}`);
    try {
      await db.execAsync("BEGIN TRANSACTION");
      for (const sql of migration.sql) {
        await db.execAsync(sql);
      }
      // Update dict_meta version
      await db.execAsync(
        `INSERT OR REPLACE INTO dict_meta (key, value) VALUES ('version', '${migration.version}')`,
      );
      await db.execAsync("COMMIT");
      currentVersion = migration.version;
      console.log(`[DictMigrate] v${migration.version} applied`);
    } catch (err) {
      console.error(`[DictMigrate] v${migration.version} failed:`, err);
      try {
        await db.execAsync("ROLLBACK");
      } catch {
        // Rollback may fail if transaction wasn't started
      }
      // Stop on first failure — don't skip broken migrations
      break;
    }
  }

  return currentVersion;
}
