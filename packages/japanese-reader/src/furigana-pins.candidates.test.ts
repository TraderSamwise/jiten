/**
 * What to offer when the reader is asked for the reading of a kanji run.
 *
 * The picker exists because no ranking settles 杏子 — きょうこ in one book and
 * あんず in the next — so the list has to CONTAIN every reading the
 * dictionaries know, with the likeliest first and nothing duplicated. These
 * cases are the four runs the whole feature was argued over.
 */

import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import type { ReaderSqlDb } from "./backend";
import { furiganaReadingCandidates } from "./furigana-pins";

function open(path: string): { db: Database.Database; wrapped: ReaderSqlDb } {
  const db = new Database(path, { readonly: true });
  return {
    db,
    wrapped: {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? db.prepare(sql).get(...(params as never[])) : db.prepare(sql).get()) as T) ??
        null,
    },
  };
}

const dict = hasBothDbs ? open(DICT_DB_PATH) : null;
const ext = hasBothDbs ? open(EXT_DB_PATH) : null;
afterAll(() => {
  dict?.db.close();
  ext?.db.close();
});

async function readings(run: string, options?: { currentReading?: string | null }) {
  const candidates = await furiganaReadingCandidates(run, dict!.wrapped, ext!.wrapped, options);
  return candidates.map((candidate) => candidate.reading);
}

describe.skipIf(!hasBothDbs)("furiganaReadingCandidates", () => {
  /**
   * The case the feature is for. きょうこ leads because it is 26 of the 33
   * sightings of this spelling, and あんず — the apricot, and what the
   * resolver picks — still has to be on the list.
   */
  it("leads 杏子 with きょうこ and still offers あんず", async () => {
    const list = await readings("杏子");
    expect(list[0]).toBe("きょうこ");
    expect(list).toContain("あんず");
    expect(list).toContain("ももこ");
  });

  /**
   * The resolver reads 後味 as the surname ごみ, which is the bug that put
   * this run on the list. The picker must lead with the word and still offer
   * the surname — the first row is what the sheet preselects.
   */
  it("leads 後味 with the word, not the surname the resolver picked", async () => {
    const list = await readings("後味");
    expect(list[0]).toBe("あとあじ");
    expect(list).toContain("ごみ");
  });

  /**
   * A spelling that is also somebody's surname must not lead with the
   * surname. Each of these did before a name reading had to be SETTLED —
   * 26 of 33 sightings, the resolver's own thresholds — to lead.
   */
  it("leads with the word where the name reading is barely attested", async () => {
    expect((await readings("大人"))[0]).toBe("おとな");
    expect((await readings("一日"))[0]).toBe("いちにち");
  });

  it("offers 高遠 the reading that must not regress", async () => {
    expect(await readings("高遠")).toContain("たかとお");
  });

  it("offers 五十嵐 its readings, commonest first", async () => {
    const list = await readings("五十嵐");
    expect(list[0]).toBe("いがらし");
    expect(list).toContain("いかざき");
  });

  /** 高遠 is たかとお in 4 of 4 sightings — settled, but under the floor of 5. */
  it("still offers a name reading too thinly attested to lead", async () => {
    expect(await readings("高遠")).toContain("たかとお");
  });

  /**
   * 読 is no word on its own; its readings come from 読み and 読む. It does NOT
   * get どく from 読書, because a long press on 読 inside 読書 reports the run
   * 読書 — a kanji neighbour is part of the run, not okurigana.
   */
  it("reads a bare kanji through the okurigana forms that carry it", async () => {
    const list = await readings("読");
    expect(list).toContain("よ");
    expect(list).not.toContain("どく");
  });

  /**
   * The resolver picks one reading; the picker has to show the rest, because
   * the one it picked is what the user is overruling.
   */
  it("offers every reading of a spelling, not just the first", async () => {
    const list = await readings("今日");
    expect(list).toContain("きょう");
    expect(list).toContain("こんにち");
    expect(list).toContain("こんじつ");
  });

  /** 煙草 really is タバコ — a katakana reading is a reading. */
  it("keeps a katakana reading as written", async () => {
    expect(await readings("煙草")).toContain("タバコ");
  });

  /**
   * JMdict's kana column holds more than readings: 16,774 rows carry
   * something that is not kana at all — 粁 is listed as キロ・メートル — 日
   * carries んち from a compound, and JMnedict lists 日 as the place name
   * にっ.
   */
  it("refuses a reading no word could have", async () => {
    const list = await readings("日");
    expect(list).not.toContain("んち");
    expect(list).not.toContain("にっ");
    expect(await readings("粁")).not.toContain("キロ・メートル");
    expect(await readings("粁")).toContain("キロメートル");
  });

  /** A row of fourteen glosses is not a label. 日 gathered 180 characters. */
  it("keeps a label short enough to read", async () => {
    for (const run of ["日", "一", "読", "大人"]) {
      for (const candidate of await furiganaReadingCandidates(run, dict!.wrapped, ext!.wrapped)) {
        expect(candidate.label?.length ?? 0).toBeLessThanOrEqual(80);
      }
    }
  });

  /** A page writes ３日 as often as 三日, and the counter table only has one. */
  it("finds a counter reading for a run written in digits", async () => {
    expect(await readings("3日")).toContain("みっか");
    expect(await readings("\uff13\u65e5")).toContain("みっか");
  });

  it("never repeats a reading", async () => {
    for (const run of ["日", "杏子", "一日", "後味", "読"]) {
      const list = await readings(run);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("puts the reading already on the page first, and only once", async () => {
    const list = await readings("杏子", { currentReading: "あんず" });
    expect(list[0]).toBe("あんず");
    expect(list.filter((reading) => reading === "あんず")).toHaveLength(1);
  });

  it("has only the current reading for a run no dictionary knows", async () => {
    expect(await readings("杏子杏子杏子", { currentReading: "ななし" })).toEqual(["ななし"]);
    expect(await readings("杏子杏子杏子")).toEqual([]);
  });

  /**
   * A known limit, pinned so it is not mistaken for a bug. JMdict restricts
   * some readings to some spellings (`re_restr`) — ひるこ belongs to 蛭子, not
   * to 恵比寿 — and `scripts/build-dictionary.ts` drops that field, so nothing
   * downstream can honour it. The picker therefore offers a few readings that
   * belong to a sibling spelling. Harmless in a list the user chooses from;
   * fixing it means rebuilding the dictionary.
   */
  it("offers readings restricted to a sibling spelling, because the dictionary drops the restriction", async () => {
    expect(await readings("恵比寿")).toContain("ひるこ");
  });

  it("says nothing about a run with no kanji in it", async () => {
    expect(await readings("ひらがな")).toEqual([]);
  });

  /**
   * A row that says only "きょうこ" tells the user nothing to choose on. Every
   * candidate has to carry what it IS — name, word, counter — and, where the
   * dictionary has one, a short definition.
   */
  it("gives every candidate a category", async () => {
    for (const run of ["杏子", "後味", "日", "一日", "三日", "読", "今日", "高遠", "煙草"]) {
      for (const candidate of await furiganaReadingCandidates(run, dict!.wrapped, ext!.wrapped)) {
        expect(candidate.kind, `${run} → ${candidate.reading}`).toBeDefined();
      }
    }
  });

  /**
   * counter_readings carries a gloss; a counter row used to show none. Written
   * in digits, because 三日 is a JMnedict place name too and the row then keeps
   * the name's category — only a digit run reaches the counter table alone.
   */
  it("gives a counter reading its gloss", async () => {
    const counters = (await furiganaReadingCandidates("3日", dict!.wrapped, ext!.wrapped)).filter(
      (candidate) => candidate.kind === "counter",
    );
    expect(counters.length).toBeGreaterThan(0);
    expect(counters[0].label).toMatch(/counter for days/);
  });

  /**
   * The reading already on the page ranks first as "current", but it is still a
   * word or a name and its row has to say which.
   */
  it("keeps the category of the reading already on the page", async () => {
    const candidates = await furiganaReadingCandidates("杏子", dict!.wrapped, ext!.wrapped, {
      currentReading: "あんず",
    });
    expect(candidates[0]).toMatchObject({ reading: "あんず", source: "current", kind: "word" });
    expect(candidates[0].label).toMatch(/apricot/);
  });

  it("labels where each reading came from", async () => {
    const candidates = await furiganaReadingCandidates("杏子", dict!.wrapped, ext!.wrapped);
    const kyouko = candidates.find((candidate) => candidate.reading === "きょうこ");
    expect(kyouko?.source).toBe("name");
    // 26 of 33 — the share is what says this spelling has settled.
    expect(kyouko?.note).toMatch(/26 of 33/);
    // あんず is a reading of the name AND the apricot. It keeps the name's
    // rank, and gathers both labels, because either alone leaves the user
    // guessing which あんず this is.
    // あんず is the apricot AND a reading of the name, but 4 sightings is not
    // settled, so the word leads and the row gathers both labels.
    const anzu = candidates.find((candidate) => candidate.reading === "あんず");
    expect(anzu?.source).toBe("word");
    expect(anzu?.label).toMatch(/apricot/);
    expect(anzu?.label).toMatch(/fem/);
  });

  it("works without an extended dictionary, losing only the names", async () => {
    const list = (await furiganaReadingCandidates("杏子", dict!.wrapped, null)).map(
      (c) => c.reading,
    );
    expect(list).toEqual(["あんず", "アンズ"]);
  });

  /** A long press is interactive; the list cannot be a page of 200 readings. */
  it("caps the list", async () => {
    expect((await readings("日")).length).toBeLessThanOrEqual(20);
  });
});
