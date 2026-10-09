/**
 * A two-kanji name the counts have seen may override a one-kanji word.
 *
 * 西條さんがそばに来て: tapping 西 answered 西/せい, "Spain", while the furigana
 * over the same two characters read さいじょう. The override floor is three
 * characters, and it is there for spans straddling a word boundary — 田先 out
 * of 山田先生 — which the frequency column now separates: 西條 has been seen 24
 * times, 田先 and 中電 never.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { nameMayOverrideShorterWord } from "./auto-name";
import { autoLookupWithOffset } from "./lookup";

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

async function tap(text: string, at: number) {
  return (await autoLookupWithOffset(text, at, wrap(dict!), wrap(ext!)))[0];
}

describe("the override floor", () => {
  it("lets a counted two-kanji name through", () => {
    expect(nameMayOverrideShorterWord(2, 24)).toBe(true);
    expect(nameMayOverrideShorterWord(2, 1)).toBe(true);
  });

  it("keeps an uncounted one out", () => {
    expect(nameMayOverrideShorterWord(2, null)).toBe(false);
    expect(nameMayOverrideShorterWord(2, 0)).toBe(false);
  });

  it("leaves three characters where they were", () => {
    expect(nameMayOverrideShorterWord(3, null)).toBe(true);
  });
});

describe.skipIf(!hasBothDbs)("a two-kanji surname under the finger", () => {
  it("answers the name from either character", async () => {
    for (const at of [12, 13]) {
      const hit = await tap("ずいぶん多くの役を演じた西條さんがそばに来て、こんな", at);
      expect(hit?.matchedText).toBe("西條");
      expect(hit?.nameMatches?.[0]?.kana).toBe("さいじょう");
    }
  });

  // The corpus's own names, each previously answered as a single-kanji word.
  it("answers the names the corpus holds", async () => {
    expect((await tap("の角をつれて、茂作の人参畠をあらした", 8))?.matchedText).toBe("茂作");
    expect((await tap("と云うと「箱根のさきですか", 6))?.matchedText).toBe("箱根");
    expect((await tap("同じ数学の教師に堀田というのが居た", 8))?.matchedText).toBe("堀田");
  });

  it("still refuses a span straddling a word boundary", async () => {
    expect((await tap("山田先生のお宅へ行った", 1))?.matchedText).not.toBe("田先");
    expect((await tap("食事中電話が鳴った", 2))?.matchedText).not.toBe("中電");
  });
});
