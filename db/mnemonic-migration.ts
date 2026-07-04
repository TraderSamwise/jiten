import { convertLegacySigils } from "@/lib/mnemonic-markup";

/** Minimal async DB surface shared by the native/web wrapped user DBs. */
export interface MnemonicMigrationDb {
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
}

const MIGRATION_FLAG = "mnemonic_markup_migrated_v1";

/**
 * One-time, device-local conversion of legacy mnemonic markup (**x**, *x*) to the
 * new grammar ({self}, [x]). Idempotent: only rows containing '*' are touched, the
 * conversion is a no-op on already-migrated text, and `updated_at` is preserved so
 * this never triggers sync churn (each device migrates its own copy independently).
 * The flag lives in app_flags, which is excluded from sync.
 *
 * Note: the personal association index (primitive_note_assoc) is not refreshed here;
 * it is local + rebuildable and best-effort, so a converted word is corrected on its
 * next rebuild.
 */
export async function migrateLegacyMnemonics(db: MnemonicMigrationDb): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [MIGRATION_FLAG],
  );
  if (done) return;

  const rows = await db.getAllAsync<{ literal: string; mnemonic: string }>(
    "SELECT literal, mnemonic FROM user_kanji_notes WHERE mnemonic LIKE '%*%' AND deleted_at IS NULL",
  );
  for (const row of rows) {
    const converted = convertLegacySigils(row.mnemonic);
    if (converted !== row.mnemonic) {
      await db.runAsync("UPDATE user_kanji_notes SET mnemonic = ? WHERE literal = ?", [
        converted,
        row.literal,
      ]);
    }
  }

  await db.runAsync("INSERT OR REPLACE INTO app_flags (key, value) VALUES (?, '1')", [
    MIGRATION_FLAG,
  ]);
}
