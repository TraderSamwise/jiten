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
import {
  autoLookupWithOffset,
  nameLookupWithOffset,
  okuriganaStartsForTap,
  smartLookupWithOffset,
} from "./lookup";

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
    // 注意に is not 注意する in any form, so に stays open: the kanji answer the
    // noun and the kana answer the particle. Asserting only "not 注意に" passed
    // before this change too, which is no gate at all.
    expect((await word("注意にも程がある", 0))?.matchedText).toBe("注意");
    expect((await word("注意にも程がある", 2))?.matchedText).toBe("にも");
  });
});

describe.skipIf(!hasBothDbs)("what a guess is allowed to land on", () => {
  // The ～なく rules reach する, and the suru-noun strip then hands back
  // whatever stood in front of it. A guess claims the surface is an inflected
  // word, so the entry it lands on has to be one.
  it("refuses a guess that lands on a particle or an adverb", async () => {
    expect((await word("る方が楽に極まってる。釣や猟をしなくっちゃ活計が", 14))?.matchedText).toBe(
      "を",
    );
    expect((await word("と三人で暮していた。おやじは何にもせぬ男で、人の", 14))?.matchedText).toBe(
      "何にも",
    );
    expect((await word("つは魚に相違ない。生きてるものでなくっちゃ、こう", 13))?.matchedText).toBe(
      "もの",
    );
  });

  // Only on a guess: the same filter over every suru-noun strip moves 869
  // corpus taps and takes 直にしていれば from 直に to the broth 煮汁.
  it("leaves the suru-noun strip alone where nothing guessed", async () => {
    expect((await word("正直にしていれば誰が乗じ", 2))?.matchedText).toBe("直にしていれば");
    expect((await word("勧誘されるのを断った", 0))?.entries[0]?.kanji[0]?.text).toBe("勧誘");
    expect((await word("出たりはいったりして、よう", 5))?.entries[0]?.kanji[0]?.text).toBe("入る");
  });

  it("still lets a guess speak when it lands on a verb", async () => {
    expect((await word("心配しなくてもいいと云い", 0))?.matchedText).toBe("心配しなくて");
    expect((await word("散歩に誘わなくなった", 3))?.matchedText).toBe("誘わなく");
  });
});

describe.skipIf(!hasBothDbs)("name mode walks the same spans", () => {
  // Name mode has its own walk, and it got the starts only after review:
  // without them it answered 注文したから with the surname たから and
  // したためだった with 為田, from inside words the word walk had closed.
  it("refuses a start inside a word", async () => {
    const starts = await okuriganaStartsForTap(
      "切ってみろと注文したから、何だ指ぐらい",
      10,
      wrap(dict!),
    );
    const guarded = await nameLookupWithOffset(
      "切ってみろと注文したから、何だ指ぐらい",
      10,
      wrap(ext!),
      starts,
    );
    expect(guarded[0]?.matchedText).not.toBe("たから");
  });

  it("still answers a name that starts at a word boundary", async () => {
    const text = "演じた西條さんがそばに来て";
    const starts = await okuriganaStartsForTap(text, 3, wrap(dict!));
    const hit = await nameLookupWithOffset(text, 3, wrap(ext!), starts);
    expect(hit[0]?.matchedText).toBe("西條");
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
