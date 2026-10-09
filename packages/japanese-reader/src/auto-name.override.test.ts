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
    expect(nameMayOverrideShorterWord("西條", 24)).toBe(true);
    expect(nameMayOverrideShorterWord("箱根", 1)).toBe(true);
  });

  it("keeps an uncounted one out", () => {
    // An extended DB built before the frequency column has no counts at all,
    // and every two-kanji override silently switches off rather than guessing.
    expect(nameMayOverrideShorterWord("田先", null)).toBe(false);
    expect(nameMayOverrideShorterWord("中電", 0)).toBe(false);
  });

  it("leaves three characters where they were", () => {
    expect(nameMayOverrideShorterWord("大泉学園", null)).toBe(true);
  });

  // 二羽 is two birds, 三巻 is volume three, 三章 is chapter three — each also
  // a name somebody has been seen with once. A number is a count until the
  // counts say otherwise.
  it("asks a span carrying a numeral for more than one sighting", () => {
    expect(nameMayOverrideShorterWord("二羽", 2)).toBe(false);
    expect(nameMayOverrideShorterWord("三章", 1)).toBe(false);
    expect(nameMayOverrideShorterWord("計三", 2)).toBe(false);
    expect(nameMayOverrideShorterWord("一郎", 393)).toBe(true);
    expect(nameMayOverrideShorterWord("七海", 38)).toBe(true);
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

  // A guard, not a gate: this is the pre-existing floor's behaviour, kept
  // under the relaxation rather than proved by it.
  it("still refuses a span straddling a word boundary", async () => {
    expect((await tap("山田先生のお宅へ行った", 1))?.matchedText).not.toBe("田先");
    expect((await tap("食事中電話が鳴った", 2))?.matchedText).not.toBe("中電");
  });

  // 東京|市 is not the given name きょういち. The counts cannot tell a straddle
  // from a surname — 京市 and 定家 are both one sighting — but the text can.
  it("refuses a two-kanji name that cuts a word in half", async () => {
    expect((await tap("これにより東京府と東京市が廃止され", 11))?.lookupKind).not.toBe("name");
    expect((await tap("その他の外来音を含める場合は", 6))?.lookupKind).not.toBe("name");
  });

  it("leaves a longer name alone, which overlaps words all the time", async () => {
    expect((await tap("云うならフランクリンの自伝", 4))?.matchedText).toBe("フランクリン");
  });

  it("answers a count with the counter, not with a name", async () => {
    expect((await tap("鳥が二羽いた。", 3))?.lookupKind).not.toBe("name");
    expect((await tap("全三巻を買った。", 2))?.lookupKind).not.toBe("name");
    expect((await tap("第三章まで進んだ。", 2))?.lookupKind).not.toBe("name");
  });
});
