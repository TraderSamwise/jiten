import { useState, useEffect, useCallback } from "react";
import { useUserDb } from "@/db/user-provider";

export function useKanjiMnemonic(literal: string) {
  const userDb = useUserDb();
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  useEffect(() => {
    if (!userDb || !literal) return;

    userDb
      .getFirstAsync<{ mnemonic: string }>(
        "SELECT mnemonic FROM user_kanji_notes WHERE literal = ?",
        [literal],
      )
      .then((row: { mnemonic: string } | null) => setMnemonic(row?.mnemonic ?? null))
      .catch(() => setMnemonic(null));
  }, [userDb, literal]);

  const saveMnemonic = useCallback(
    async (text: string) => {
      if (!userDb || !literal) return;
      const now = new Date().toISOString();
      if (text.trim()) {
        await userDb.runAsync(
          `INSERT INTO user_kanji_notes (literal, mnemonic, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(literal) DO UPDATE SET mnemonic = excluded.mnemonic, updated_at = excluded.updated_at`,
          [literal, text.trim(), now],
        );
        setMnemonic(text.trim());
      } else {
        await userDb.runAsync("DELETE FROM user_kanji_notes WHERE literal = ?", [literal]);
        setMnemonic(null);
      }
    },
    [userDb, literal],
  );

  return { mnemonic, saveMnemonic };
}
