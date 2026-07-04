import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { rebuildAllAssociations } from "./primitive-associations";

const BACKFILL_FLAG = "assoc_index_backfilled_v1";

/**
 * One-time population of the personal primitive-association index from all existing
 * mnemonics. Requires the strokes tier (which carries the primitive decomposition), so
 * it no-ops until strokes is available and only marks itself done once a real rebuild ran
 * — leaving the flag unset while strokes is still downloading so it retries next launch.
 */
export async function runAssociationBackfill(
  userDb: WrappedUserDb,
  strokesDb: SQLite.SQLiteDatabase | null,
): Promise<void> {
  if (!strokesDb) return;
  const done = await userDb.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [BACKFILL_FLAG],
  );
  if (done) return;
  await rebuildAllAssociations(userDb, strokesDb);
  await userDb.runAsync("INSERT OR REPLACE INTO app_flags (key, value) VALUES (?, '1')", [
    BACKFILL_FLAG,
  ]);
}
