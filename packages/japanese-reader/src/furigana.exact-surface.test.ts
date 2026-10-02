/**
 * A word spelled exactly as the page spells it keeps the page.
 *
 * 後味 is the case this exists for. 後味が悪い is the set phrase; ごみ is a
 * JMnedict surname with no observed use at all, and the reader was printing it
 * over the word. The name wins on type alone — `surname` is worth 18 — and the
 * only thing standing against it was the discount a word gets for being spelled
 * exactly this way, which was 16 against a threshold of 90 and left 後味 at 93.
 *
 * It is now 20. That is the whole change, and it is a tie-break, not a rule
 * about frequency: the readings this moves are ones where the dictionary has an
 * exact kanji form for the word and JMnedict has a name nobody has been
 * observed to read that way.
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

async function reading(surface: string): Promise<{ reading?: string; isName?: boolean }> {
  const map = await resolveFuriganaBatch([surface], wrap(dict!), wrap(ext!));
  return map[surface] ?? {};
}

describe.skipIf(!hasBothDbs)("an exact word spelling against an uncounted name", () => {
  it("reads 後味 as the word, not the surname", async () => {
    const got = await reading("後味");
    expect(got.reading).toBe("あとあじ");
    expect(got.isName).toBeFalsy();
  });

  /** The words the sweep showed this reaches, each one a word on the page. */
  it("reads the other exact spellings the corpus holds as words", async () => {
    expect((await reading("人声")).reading).toBe("ひとごえ");
    expect((await reading("出立")).reading).toBe("しゅったつ");
    expect((await reading("田楽")).reading).toBe("でんがく");
    expect((await reading("西日")).reading).toBe("にしび");
    expect((await reading("船端")).reading).toBe("ふなばた");
    expect((await reading("金満")).reading).toBe("きんまん");
  });

  /**
   * A name the counts HAVE settled on keeps the shallower discount, or this
   * stops being a tie-break: 109 is the most the branch can score, so a flat
   * 20 would mean no name ever beating a non-common exact word again. 丸木 is
   * a surname in the corpus — 丸木が芝の写真師で — and a flat 20 took its name
   * reading away.
   */
  it("leaves a settled name on a spelling that is also a word", async () => {
    const got = await reading("丸木");
    expect(got.isName).toBe(true);
  });

  /**
   * The counted names must not move. 杏子 is きょうこ in 26 sightings of 33,
   * and that is what the frequency work exists for — a deeper discount for an
   * exact spelling must not undo it.
   */
  it("leaves a name the corpus has settled on", async () => {
    const got = await reading("杏子");
    expect(got.reading).toBe("きょうこ");
    expect(got.isName).toBe(true);
  });

  /**
   * The one regression, named and accepted. 肋骨 is ろっこつ in practice, and
   * it was reaching that reading through JMnedict. The word entry lists
   * あばらぼね first and the dictionary build keeps JMdict's order, so taking
   * the word hands back the rarer of its two readings. The cause is the kana
   * order, not this discount.
   */
  it("hands 肋骨 to the word, which spells it あばらぼね", async () => {
    expect((await reading("肋骨")).reading).toBe("あばらぼね");
  });

  /**
   * Three of the sweep's 33 are substring artefacts — the corpus says
   * 一本立っている, 二階下に居た and 小間物, so neither reading is of a word
   * that is there. Pinned so that a later change to them is read as what it
   * is and not mistaken for a fix.
   */
  it("moves three substrings that are not words on the page either way", async () => {
    expect((await reading("本立")).reading).toBe("ほんたて");
    expect((await reading("階下")).reading).toBe("かいか");
    expect((await reading("間物")).reading).toBe("あいだもの");
  });
});
