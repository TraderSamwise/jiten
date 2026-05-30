import { useEffect, useState } from "react";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getKanjiBatchAsync, getRadicalsForKanjiAsync } from "@/db/kanji-search";

export interface MnemonicData {
  mnemonic: string | null;
  primaryKeywords: string[];
  componentKeywords: string[];
}

const EMPTY: MnemonicData = { mnemonic: null, primaryKeywords: [], componentKeywords: [] };

export function useMnemonicData(literal: string | null | undefined): MnemonicData {
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
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

      const [selfBatch, radicals] = await Promise.all([
        getKanjiBatchAsync(dictDb, [literal]),
        getRadicalsForKanjiAsync(dictDb, literal),
      ]);
      if (cancelled) return;
      const kanji = selfBatch[0] ?? null;
      const compLiterals = radicals.filter((r) => r !== literal);

      const componentKanji = compLiterals.length
        ? await getKanjiBatchAsync(dictDb, compLiterals)
        : [];
      if (cancelled) return;

      const componentUserKw = new Map<string, string>();
      if (compLiterals.length) {
        const placeholders = compLiterals.map(() => "?").join(",");
        const rows = await userDb.getAllAsync<{ literal: string; keyword: string }>(
          `SELECT literal, keyword FROM user_kanji_notes WHERE literal IN (${placeholders}) AND keyword IS NOT NULL AND keyword != '' AND deleted_at IS NULL`,
          compLiterals,
        );
        for (const r of rows) componentUserKw.set(r.literal, r.keyword);
      }
      if (cancelled) return;

      const primaryKeywords = [noteRow?.keyword, kanji?.heisigKeyword].filter(Boolean) as string[];
      const componentKeywords: string[] = [];
      const ckMap = new Map(componentKanji.map((k) => [k.literal, k]));
      for (const r of compLiterals) {
        const userKw = componentUserKw.get(r);
        if (userKw) componentKeywords.push(userKw);
        const ck = ckMap.get(r);
        if (ck?.heisigKeyword) componentKeywords.push(ck.heisigKeyword);
        else if (ck?.meanings[0]) componentKeywords.push(ck.meanings[0]);
      }

      setData({ mnemonic, primaryKeywords, componentKeywords });
    })().catch(() => {
      if (!cancelled) setData(EMPTY);
    });

    return () => {
      cancelled = true;
    };
  }, [userDb, dictDb, literal]);

  return data;
}
