/**
 * A kanji followed by a particle is the particle.
 *
 * 花のつぼみ printed あや over 花 and 水の流れ printed にず over 水: JMnedict
 * holds 花の (Ayano) and 水の (Nizuno), the surface was two characters so it
 * beat the one-character word, and the ruby that came out covered the kanji
 * alone — a reading only the whole name has, over a noun and a particle.
 *
 * Refusing every kana-tailed name was too wide, and review caught it: it took
 * the reading off 十勝ダム and 一戸トンネル entirely (their kanji prefix is a
 * counter form, and a settings-rejected counter shadows the span) and garbled
 * 三条通り into 三条通【さんじょうどおり】り. Only a particle is the bug.
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

describe.skipIf(!hasBothDbs)("a name spelled with a trailing particle", () => {
  it("is not read as a name", async () => {
    expect((await entry("花の")).isName).toBeFalsy();
    expect((await entry("水の")).isName).toBeFalsy();
    expect((await entry("上の")).isName).toBeFalsy();
    expect((await entry("木の")).isName).toBeFalsy();
  });

  // A guard, not a gate: these read the same before and after the change.
  it("leaves the kanji run itself to the word it is", async () => {
    expect((await entry("花")).reading).toBe("はな");
    expect((await entry("水")).reading).toBe("みず");
  });

  it("leaves a name whose tail is not a particle alone", async () => {
    // り is the name's own okurigana, and the reading covers 三条通 without it.
    expect((await entry("三条通り")).reading).toBe("さんじょうどお");
    expect((await entry("十勝ダム")).isName).toBe(true);
    expect((await entry("一戸トンネル")).isName).toBe(true);
    expect((await entry("お染め")).reading).toBe("おそ");
  });

  // Guards, not gates: both read the same before and after the change.
  it("keeps the reading on the kanji the ruby actually covered", async () => {
    expect((await entry("帝国")).reading).toBe("ていこく");
  });

  // The same doctrine on the furigana side: 拠なく and 得なく are 拠ない and
  // 得ない, entries, and must not be read as 拠る and 得る because those are
  // commoner. `scoreFuriganaWordMatch` pays commonness +120 against a
  // deinflection penalty of −80, so this has to be a preference, not a weight.
  it("prefers a reading that needs no guess", async () => {
    expect((await entry("拠なく")).reading).toBe("よんどころ");
    expect((await entry("得なく")).reading).toBe("え");
    expect((await entry("弛まなく")).reading).toBe("たゆ");
    // And a guess still speaks where nothing else does.
    expect((await entry("畳まぬ")).reading).toBe("たた");
    expect((await entry("誘わなく")).reading).toBe("さそ");
  });

  it("leaves a name written in kanji alone", async () => {
    expect((await entry("西條")).isName).toBe(true);
    expect((await entry("杏子")).reading).toBe("きょうこ");
    expect((await entry("五十嵐")).reading).toBe("いがらし");
  });
});
