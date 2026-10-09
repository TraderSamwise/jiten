/**
 * Where a span may begin, and what a name has to be to win one.
 *
 * 赴任したためだった answered したため — the archaic 認む, "to write down" —
 * because 赴任した could not prove its own kana tail: the chain runs through
 * 赴任する, which no dictionary spells, to 赴任, which every dictionary does,
 * and that second step was counted as a second word.
 *
 * Closing those starts then exposed the other half: the name walk had no such
 * guard, so 注文したから came back as the surname たから — a kana run that is a
 * name's READING, not a name's spelling.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { autoLookupWithOffset, smartLookupWithOffset } from "./lookup";

const dict = hasBothDbs ? new Database(DICT_DB_PATH, { readonly: true }) : null;
const ext = hasBothDbs ? new Database(EXT_DB_PATH, { readonly: true }) : null;
afterAll(() => {
  dict?.close();
  ext?.close();
});

const wrap = (db: Database.Database) => ({
  async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return db.prepare(sql).all(...(params ?? [])) as T[];
  },
  async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
    return (db.prepare(sql).get(...(params ?? [])) as T) ?? null;
  },
});

const word = async (text: string, at: number) =>
  (await smartLookupWithOffset(text, at, wrap(dict!), wrap(ext!)))[0];
const auto = async (text: string, at: number) =>
  (await autoLookupWithOffset(text, at, wrap(dict!), wrap(ext!)))[0];

describe.skipIf(!hasBothDbs)("a suru-verb noun proves its own kana tail", () => {
  it("closes the し and た of 赴任した", async () => {
    expect((await word("海外へ赴任したためだった。", 7))?.matchedText).toBe("ため");
    expect((await auto("海外へ赴任したためだった。", 7))?.matchedText).toBe("ため");
  });

  it("stops a span cutting into 注文した, 勉強して, 合点した", async () => {
    expect((await word("切ってみろと注文したから、何だ指ぐらい", 10))?.matchedText).toBe("から");
    expect((await word("学資にして勉強してやろう。六百円を", 9))?.matchedText).toBe("やろう");
    expect((await word("相違ないと合点したものらしい。", 9))?.matchedText).toBe("もの");
  });

  it("leaves a noun's trailing particle alone", async () => {
    // 注意に is not 注意する in any form, so に stays open.
    expect((await word("注意にも程がある", 3))?.matchedText).not.toBe("注意に");
  });
});

describe.skipIf(!hasBothDbs)("what a name has to be to outrank a word", () => {
  it("refuses a kana run that is only a name's reading", async () => {
    const hit = await auto("切ってみろと注文したから、何だ指ぐらい", 10);
    expect(hit?.lookupKind).not.toBe("name");
    expect(hit?.matchedText).toBe("から");
  });

  it("keeps a name that is spelled the way the page spells it", async () => {
    expect((await auto("ひろしに聞いた", 0))?.nameMatches?.[0]?.kana).toBe("ひろし");
    expect((await auto("演じた西條さんがそばに来て", 3))?.matchedText).toBe("西條");
  });
});
