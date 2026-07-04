import { useEffect, useState } from "react";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getKanjiBatchAsync, getPrimitivesForKanjiAsync } from "@/db/kanji-search";
import type { KanjiPrimitive } from "@/db/types";

export interface MnemonicData {
  mnemonic: string | null;
  primaryKeywords: string[];
  primitives: KanjiPrimitive[];
}

const EMPTY: MnemonicData = {
  mnemonic: null,
  primaryKeywords: [],
  primitives: [],
};

export function useMnemonicData(literal: string | null | undefined): MnemonicData {
  const userDb = useUserDb();
  const { dictDb, strokesDb } = useDatabase();
  const [data, setData] = useState<MnemonicData>(EMPTY);

  useEffect(() => {
    if (!userDb || !dictDb || !literal) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;

    (async () => {
      const noteRow = await userDb.getFirstAsync<{ mnemonic: string; keyword: string | null }>(
        "SELECT mnemonic, keyword FROM user_kanji_notes WHERE literal = ? AND deleted_at IS NULL",
        [literal],
      );
      if (cancelled) return;
      const mnemonic = noteRow?.mnemonic ?? null;
      if (!mnemonic) {
        setData(EMPTY);
        return;
      }

      const [selfBatch, primitives] = await Promise.all([
        getKanjiBatchAsync(dictDb, [literal]),
        strokesDb
          ? getPrimitivesForKanjiAsync(strokesDb, literal)
          : Promise.resolve<KanjiPrimitive[]>([]),
      ]);
      if (cancelled) return;

      const kanji = selfBatch[0] ?? null;
      const primaryKeywords = [noteRow?.keyword, kanji?.heisigKeyword].filter(Boolean) as string[];

      setData({ mnemonic, primaryKeywords, primitives });
    })().catch(() => {
      if (!cancelled) setData(EMPTY);
    });

    return () => {
      cancelled = true;
    };
  }, [userDb, dictDb, strokesDb, literal]);

  return data;
}
