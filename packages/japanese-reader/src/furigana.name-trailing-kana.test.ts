/**
 * A name spelling that ends in kana is not evidence about the kanji before it.
 *
 * 花のつぼみ printed あや over 花 and 水の流れ printed にず over 水: JMnedict
 * holds 花の (Ayano) and 水の (Nizuno), the surface was two characters so it
 * beat the one-character word, and the ruby that came out covered the kanji
 * alone — a reading only the whole name has, over a noun and a particle.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { resolveFuriganaBatch } from "./furigana";

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

async function entry(surface: string): Promise<{ reading?: string; isName?: boolean }> {
  const map = await resolveFuriganaBatch([surface], wrap(dict!), wrap(ext!));
  return map[surface] ?? {};
}

describe.skipIf(!hasBothDbs)("a name spelled with trailing kana", () => {
  it("is not read as a name", async () => {
    expect((await entry("花の")).isName).toBeFalsy();
    expect((await entry("水の")).isName).toBeFalsy();
    expect((await entry("上の")).isName).toBeFalsy();
    expect((await entry("木の")).isName).toBeFalsy();
  });

  it("leaves the kanji run itself to the word it is", async () => {
    expect((await entry("花")).reading).toBe("はな");
    expect((await entry("水")).reading).toBe("みず");
  });

  // The kanji half of a place name still carries it, which is what the page
  // shows either way: the ruby never covered the katakana.
  it("keeps the reading on the kanji the ruby actually covered", async () => {
    expect((await entry("帝国")).reading).toBe("ていこく");
  });

  it("leaves a name written in kanji alone", async () => {
    expect((await entry("西條")).isName).toBe(true);
    expect((await entry("杏子")).reading).toBe("きょうこ");
    expect((await entry("五十嵐")).reading).toBe("いがらし");
  });
});
