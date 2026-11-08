/**
 * Two furigana readings reported from the reader on 2026-11-08, both on a
 * kanji standing alone in its run.
 *
 * The resolver and the tap read the same characters and disagree: the ruby over
 * 娘 says じょう while tapping it says むすめ. Pinned here because the fix is a
 * ranking change and this is where it would show.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { resolveFuriganaBatch } from "./furigana";
import { smartLookupWithOffset } from "./lookup";

const dict = hasBothDbs ? new Database(DICT_DB_PATH, { readonly: true }) : null;
const ext = hasBothDbs ? new Database(EXT_DB_PATH, { readonly: true }) : null;
afterAll(() => {
  dict?.close();
  ext?.close();
});
const wrap = (db: Database.Database) => ({
  async getAllAsync<T>(sql: string, p?: unknown[]): Promise<T[]> {
    return db.prepare(sql).all(...(p ?? [])) as T[];
  },
  async getFirstAsync<T>(sql: string, p?: unknown[]): Promise<T | null> {
    return (db.prepare(sql).get(...(p ?? [])) as T) ?? null;
  },
});

describe.skipIf(!hasBothDbs)("furigana over a kanji standing alone", () => {
  /**
   * JMdict holds two common entries spelled 娘: 1355930 娘/じょう and 1531190
   * 娘/むすめ. The tap ranks むすめ first; the furigana resolver writes じょう
   * over every bare 娘 on the page. Nothing about the page separates them, so
   * this is a ranking disagreement between the two readers of the same table,
   * not a missing rule.
   */
  it("娘 gets じょう from the resolver and むすめ from the tap", async () => {
    const furigana = await resolveFuriganaBatch(["娘"], wrap(dict!), wrap(ext!));
    expect(furigana["娘"]?.reading).toBe("じょう");

    const text = "娘の無事を黙ってられるか";
    const [top] = await smartLookupWithOffset(text, 0, wrap(dict!), wrap(ext!));
    expect(top.entries[0].kana[0].text).toBe("むすめ");
  });

  /**
   * 遅え is the colloquial 遅い, which nothing in the dictionary spells, so the
   * kanji run is the single character 遅 and the resolver falls back to the
   * on-reading — and marks it a name. Fixing this is the same 〜い → 〜え rule
   * the tap needs (see lookup.reported-taps.test.ts); there is no furigana-side
   * fix, because by the time the resolver sees 遅 alone the verb is gone.
   */
  it("遅 in 遅えよ gets the on-reading, as a name", async () => {
    const furigana = await resolveFuriganaBatch(["遅"], wrap(dict!), wrap(ext!));
    expect(furigana["遅"]?.reading).toBe("ち");
    expect(furigana["遅"]?.isName).toBe(true);
  });
});
