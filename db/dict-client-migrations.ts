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
  /**
   * Whether this migration may run against an in-memory dict image (web).
   *
   * Web has no dict file: the bytes are deserialized into the wasm heap, and
   * `sqlite3_deserialize` is handed a buffer sized exactly to the image. A
   * write that stays inside the pages already there is fine; one that has to
   * grow the image is not. Growth reaches `memdbEnlarge`, and in this
   * wa-sqlite build that either traps the whole wasm instance with "memory
   * access out of bounds" or — if the buffer is given headroom — silently
   * returns a malformed image. Measured against the published v23 dict:
   * `ALTER TABLE ADD COLUMN` commits with `integrity_check` still ok, while
   * `CREATE INDEX` and a 2 MB insert both trap.
   *
   * One trap is not survivable. Every database in the app shares a single
   * SQLite worker and a single wasm instance, so trapping it here takes the
   * user DB and the audio, strokes and extended dicts down with it — the
   * "Database Error" screen, on a boot that never touched user data.
   *
   * Set this false for anything that writes rows or builds an index. Web skips
   * it (and everything after it, so ordering still holds) and throws the
   * migrated dict away at the end of the session regardless.
   */
  inMemorySafe: boolean;
}

/**
 * Add new migrations here when bumping DICT_VERSION ahead of DICT_BASE_VERSION.
 * Each entry must have a unique version number greater than DICT_BASE_VERSION.
 */
export const CLIENT_DICT_MIGRATIONS: ClientDictMigration[] = [
  {
    // The column only, not the prose: 2,200 glyph origins are too much to carry
    // in the app bundle, so they ride the next published dict (base v25). This
    // lets every query read the column in the meantime instead of probing for it.
    version: 24,
    description: "Add glyph_origin column to kanji_characters",
    sql: ["ALTER TABLE kanji_characters ADD COLUMN glyph_origin TEXT"],
    // Schema row only — it fits in the pages the image already has.
    inMemorySafe: true,
  },
  {
    // Migration 014 created an index on heisig_lesson; migration 020 rebuilt
    // kanji_characters and recreated six of its indexes, not this one. Every
    // "give me lesson N" since has walked all 3,000 Heisig-indexed rows and
    // read each full record to test the column — 27x slower than the seek, and
    // far worse than that on a phone reading cold pages out of a 120 MB file.
    version: 25,
    description: "Restore the index on heisig_lesson",
    sql: [
      // Dropped first: migration 014 created an index of this name on
      // heisig_lesson alone, and CREATE IF NOT EXISTS would leave that one in
      // place — which costs a row fetch per frame instead of covering the read.
      "DROP INDEX IF EXISTS idx_kc_heisig_lesson",
      "CREATE INDEX IF NOT EXISTS idx_kc_heisig_lesson ON kanji_characters(heisig_lesson, heisig_index)",
    ],
    // Building the index grows the image, which web cannot survive. No loss
    // there: the index exists to spare a phone the cold page reads out of a
    // 120 MB file, and web has already paid for the whole dict in RAM, where
    // scanning 3,000 Heisig-indexed rows is not worth a boot failure.
    inMemorySafe: false,
  },
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
  options: { inMemory?: boolean } = {},
): Promise<number> {
  const { inMemory = false } = options;
  const pending = CLIENT_DICT_MIGRATIONS.filter(
    (m) => m.version > fromVersion && m.version <= toVersion,
  ).sort((a, b) => a.version - b.version);

  if (pending.length === 0) return fromVersion;

  console.log(
    `[DictMigrate] Applying ${pending.length} client migration(s): v${fromVersion} → v${toVersion}`,
  );

  let currentVersion = fromVersion;

  for (const migration of pending) {
    if (inMemory && !migration.inMemorySafe) {
      // Stop rather than skip ahead: a later migration may assume this one ran.
      console.log(
        `[DictMigrate] v${migration.version} (${migration.description}) cannot run on an in-memory dict — stopping at v${currentVersion}`,
      );
      break;
    }
    console.log(`[DictMigrate] v${migration.version}: ${migration.description}`);
    try {
      await db.execAsync("BEGIN TRANSACTION");
      for (const sql of migration.sql) {
        await db.execAsync(sql);
      }
      // Record the version, except in memory, where nothing is persisted and
      // the write is one more chance to grow the image past its buffer.
      if (!inMemory) {
        await db.execAsync(
          `INSERT OR REPLACE INTO dict_meta (key, value) VALUES ('version', '${migration.version}')`,
        );
      }
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
