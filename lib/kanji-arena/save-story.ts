import type { SQLiteDatabase } from "expo-sqlite";

import { updateAssociationsForNote } from "@/db/primitive-associations";
import { softDelete } from "@/db/sync-helpers";
import type { WrappedUserDb } from "@/db/user-db";

// Persist a mnemonic story to the user's kanji notes — the same upsert the
// KanjiDetail editor uses, but non-hook so the arena route can save on the fly.
// Only touches `mnemonic` (a keyword override, if any, is preserved). The caller
// triggers sync (markDirty) after this resolves.
export async function saveArenaStory(
  userDb: WrappedUserDb,
  strokesDb: SQLiteDatabase | null,
  literal: string,
  text: string,
): Promise<void> {
  const mnemonic = text.trim();
  const now = new Date().toISOString();
  if (mnemonic) {
    await userDb.runAsync(
      `INSERT INTO user_kanji_notes (literal, mnemonic, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(literal) DO UPDATE SET mnemonic = excluded.mnemonic, updated_at = excluded.updated_at, deleted_at = NULL`,
      [literal, mnemonic, now],
    );
  } else {
    await softDelete(userDb, "user_kanji_notes", "literal = ?", [literal]);
  }
  if (strokesDb) {
    updateAssociationsForNote(userDb, strokesDb, literal, mnemonic || null).catch(() => {});
  }
}
