import { useState, useEffect, useCallback } from "react";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { softDelete } from "@/db/sync-helpers";
import { useSync } from "@/db/sync-provider";
import { updateAssociationsForNote } from "@/db/primitive-associations";

interface KanjiNotesRow {
  mnemonic: string;
  keyword: string | null;
}

export function useKanjiMnemonic(literal: string) {
  const userDb = useUserDb();
  const { strokesDb } = useDatabase();
  const { markDirty } = useSync();
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string | null>(null);
  // Until this is true, `mnemonic` being null means "not read yet", not "none" —
  // and a caller that writes both fields would erase a story it never saw.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userDb || !literal) return;

    userDb
      .getFirstAsync<KanjiNotesRow>(
        "SELECT mnemonic, keyword FROM user_kanji_notes WHERE literal = ? AND deleted_at IS NULL",
        [literal],
      )
      .then((row: KanjiNotesRow | null) => {
        setMnemonic(row?.mnemonic || null);
        setKeyword(row?.keyword ?? null);
        setLoaded(true);
      })
      .catch(() => {
        setMnemonic(null);
        setKeyword(null);
      });
  }, [userDb, literal]);

  const upsertOrDelete = useCallback(
    async (newMnemonic: string | null, newKeyword: string | null) => {
      if (!userDb || !literal) return;
      const now = new Date().toISOString();
      const m = newMnemonic?.trim() || "";
      const k = newKeyword?.trim() || null;

      if (m || k) {
        await userDb.runAsync(
          `INSERT INTO user_kanji_notes (literal, mnemonic, keyword, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(literal) DO UPDATE SET mnemonic = excluded.mnemonic, keyword = excluded.keyword, updated_at = excluded.updated_at, deleted_at = NULL`,
          [literal, m, k, now],
        );
      } else {
        await softDelete(userDb, "user_kanji_notes", "literal = ?", [literal]);
      }
      markDirty();
      // Keep the personal association index in step with the saved story (best-effort).
      updateAssociationsForNote(userDb, strokesDb, literal, m || null).catch(() => {});
    },
    [userDb, strokesDb, literal, markDirty],
  );

  const saveMnemonic = useCallback(
    async (text: string) => {
      const newMnemonic = text.trim() || null;
      setMnemonic(newMnemonic);
      await upsertOrDelete(newMnemonic, keyword);
    },
    [upsertOrDelete, keyword],
  );

  const saveKeyword = useCallback(
    async (text: string) => {
      const newKeyword = text.trim() || null;
      setKeyword(newKeyword);
      await upsertOrDelete(mnemonic, newKeyword);
    },
    [upsertOrDelete, mnemonic],
  );

  /**
   * Both at once. saveMnemonic and saveKeyword each carry the other value from
   * their render closure, so calling them in one handler writes a stale one
   * over the fresh one — a caller that changes both needs this instead.
   */
  const saveNote = useCallback(
    async (text: string, keywordText: string) => {
      const newMnemonic = text.trim() || null;
      const newKeyword = keywordText.trim() || null;
      setMnemonic(newMnemonic);
      setKeyword(newKeyword);
      await upsertOrDelete(newMnemonic, newKeyword);
    },
    [upsertOrDelete],
  );

  return { mnemonic, keyword, loaded, saveMnemonic, saveKeyword, saveNote };
}
