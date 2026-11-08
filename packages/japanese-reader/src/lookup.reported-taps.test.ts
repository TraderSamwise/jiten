/**
 * Taps and drag selections reported from the reader on 2026-11-08, reading
 * 天使の梯子. Each case runs the shipping function on the sentence it was
 * reported in and pins the answer it gives **today**, so a change to the
 * scorer, the deinflector or the segmenter shows up here as a diff rather than
 * as a surprise on the device.
 *
 * Where today's answer is wrong the comment says which root cause it belongs
 * to and whether it is judged fixable — see docs/reader-lookup-decisions.md.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { selectionLookup, smartLookupWithOffset } from "./lookup";

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

/** The span a tap resolves, and the headword of the entry it ranks first. */
async function tap(text: string, at: number): Promise<{ span: string; head: string }> {
  const [top] = await smartLookupWithOffset(text, at, wrap(dict!), wrap(ext!));
  if (!top) return { span: "", head: "" };
  const entry = top.entries[0];
  const head = entry ? (entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "") : "";
  return { span: top.matchedText, head };
}

describe.skipIf(!hasBothDbs)("taps reported from the reader", () => {
  /**
   * A span that begins part-way through a kana run, straddling the boundary
   * between two real words and winning on length alone. This is the open issue
   * already named in the decisions doc ("Kana-run junk in tap lookup"): with no
   * kanji nearby there is nothing local to rule it out, so ruling them out
   * needs part-of-speech and connection costs across the line, i.e. an
   * analyzer. Not fixable case by case without overfitting.
   */
  const KANA_RUN_JUNK: Record<string, { text: string; at: string; today: string }> = {
    // want さらり (adv-to); 新/さら is common and shorter, so it wins.
    "さらり → さら": {
      text: "ともかく、あまりにもさらりとし過ぎている気が",
      at: "さ",
      today: "さら",
    },
    // want おてんば; the span stops one character short of the word.
    "おてんば → おてん": { text: "けっこうおてんばだったんだ", at: "ん", today: "おてん" },
    // want こう + なった; うなった straddles こう|なった and reaches 唸る.
    "こうなった → うなった": {
      text: "こうなったことが不思議なんじゃなく、",
      at: "な",
      today: "うなった",
    },
    // want 揉む; まして starts inside the verb and reaches 況して.
    "揉まして → まして": { text: "若い男に腰揉ましてんだから", at: "ま", today: "まして" },
  };
  for (const [name, c] of Object.entries(KANA_RUN_JUNK)) {
    it(`kana-run junk: ${name}`, async () => {
      expect((await tap(c.text, c.text.indexOf(c.at))).span).toBe(c.today);
    });
  }

  /**
   * The same shape across a change of script. Hiragana into katakana is a
   * boundary the walk cannot see: に + キリム reads as にキ / にキリ, and 煮切り
   * is a real entry. A script-boundary rule is worth measuring, but it has to
   * leave katakana→hiragana open (ググる, ノックする).
   */
  it("script boundary: a span may not run from hiragana into katakana", async () => {
    const text = "そのすぐ下にキリムが敷かれている";
    for (const at of ["に", "キ", "リ"]) {
      const { span } = await tap(text, text.indexOf(at));
      expect(span, `tapping ${at} gave 「${span}」`).not.toMatch(
        /^[\u3040-\u309f]+[\u30a0-\u30ff]/,
      );
    }
  });

  /** Katakana into hiragana stays open — それ is how ググる and サボる are built. */
  it("katakana into hiragana is still allowed", async () => {
    const text = "ちょっとググってみる";
    expect((await tap(text, text.indexOf("グ"))).span).toBe("ググって");
  });

  /**
   * A deinflection the entry's part of speech cannot take. 甲乙 is a noun and
   * cannot have an imperative, so こうおて is not a form of it. The painter
   * already refuses these (`entryAdmitsInflection` in bookmarks.ts); the tap
   * does not. Fixable, with the gate already written one file away.
   */
  it("impossible inflection: けっこうおてんば does not reach 甲乙", async () => {
    const text = "けっこうおてんばだったんだ";
    const { span, head } = await tap(text, text.indexOf("お"));
    expect({ span, head }).not.toEqual({ span: "こうおて", head: "甲乙" });
  });

  /**
   * Colloquial vowel changes the deinflector does not know: 〜ない → 〜ねえ and
   * 〜い → 〜え, both everywhere in this novel's dialogue. Fixable as rules, but
   * each widens every kana run, so they have to go through the tap sweep.
   */
  it("colloquial 〜ねえ: 減らねえ gives the bare kanji", async () => {
    const text = "こんなに口の減らねえばばあ、そう";
    expect(await tap(text, text.indexOf("減"))).toEqual({ span: "減", head: "減" });
  });
  it("colloquial 〜え: 遅えよ finds nothing on the kanji", async () => {
    const text = "「……遅えよ」とつぶやくと、";
    expect((await tap(text, text.indexOf("遅"))).span).toBe("");
  });
  it("causative contraction 〜せて→〜して: 揉まして does not reach 揉む", async () => {
    const text = "若い男に腰揉ましてんだから";
    expect((await tap(text, text.indexOf("揉"))).span).toBe("");
  });

  /**
   * ～ちゃう attaches to the verb before it. The chain reaches the auxiliary on
   * its own and leaves 着 behind, so tapping the kanji answers the suffix
   * 着/ぎ "clothes" rather than 着る.
   */
  it("着ちゃえば answers 着/ぎ, not 着る", async () => {
    const text = "コート着ちゃえばわからないし";
    expect(await tap(text, text.indexOf("着"))).toEqual({ span: "着", head: "着" });
  });

  /**
   * A single kanji followed by another kanji is re-sorted by reading pattern
   * alone: `scoreSingleKanjiEntryForTap` returns that score **instead of**
   * adding it to the base one, so commonness, exact-surface and the counter
   * penalty are all dropped. 腰 before 揉 therefore hands the tap the
   * non-common counter entry 腰/よう. Everywhere else the order is right.
   * Fixable and well isolated.
   */
  it("腰 before a kanji ranks the counter entry first", async () => {
    const firstEntry = async (text: string) =>
      (await smartLookupWithOffset(text, text.indexOf("腰"), wrap(dict!), wrap(ext!)))[0].entries[0]
        .id;
    expect(await firstEntry("若い男に腰揉ましてんだから")).toBe(1288340); // the common noun
    expect(await firstEntry("腰が痛い")).toBe(1288340); // the common noun — correct
    expect(await firstEntry("彼の腰は")).toBe(1288340);
  });

  /**
   * The page spells 駆られる, and JMdict holds that exact entry (1636460) as
   * well as the verb it inflects from (1244840 駆る). The tap offers only the
   * deinflected one, so when 駆られる is also bookmarked the saved-word pill is
   * appended beside it — two pills, both labelled 駆られる, which is the
   * outcome "A tap offers the bookmarked word inside its own span" set out to
   * avoid. The duplicate is a symptom; the missing exact-surface entry is the
   * cause.
   */
  it("駆られる offers the exact entry as well as the deinflected one", async () => {
    const text = "このごろ俺はしょっちゅう不安に駆られる。";
    const [top] = await smartLookupWithOffset(text, text.indexOf("駆"), wrap(dict!), wrap(ext!));
    expect(top.matchedText).toBe("駆られる");
    expect(top.entries.map((e) => e.id)).toContain(1636460); // the exact surface
  });

  /** Correct today. Pinned so that a fix elsewhere cannot quietly break them. */
  it("still correct: とりつくろう, 冷たく, 駆られる", async () => {
    const mend = "その場を適当にとりつくろうこともできない";
    expect((await tap(mend, mend.indexOf("と", 5))).span).toBe("とりつくろう");
    const cold = "シャンプー台の足もとで冷たくなっているばあちゃんを";
    expect(await tap(cold, cold.indexOf("冷"))).toEqual({ span: "冷たく", head: "冷たい" });
    const driven = "このごろ俺はしょっちゅう不安に駆られる。";
    expect(await tap(driven, driven.indexOf("駆"))).toEqual({ span: "駆られる", head: "駆る" });
  });
});

describe.skipIf(!hasBothDbs)("drag selections reported from the reader", () => {
  async function selected(sel: string, prefix: string, suffix: string): Promise<string[]> {
    const out: string[] = [];
    await selectionLookup(sel, wrap(dict!), (r) => out.push(r.matchedText), {
      prefix,
      suffix,
      extendedDb: wrap(ext!),
    });
    return out;
  }

  /**
   * Selecting 蕎麦焼酎 decomposes into two words, both right. The panel showed
   * only the first, which is a display question rather than a lookup one.
   */
  it("蕎麦焼酎 decomposes into 蕎麦 + 焼酎", async () => {
    expect(await selected("蕎麦焼酎", "そうそう。", "もなかなかよね")).toEqual(["蕎麦", "焼酎"]);
  });

  /** The same 〜え gap as the tap: nothing spells 遅え, so it falls to kana. */
  it("遅えよ falls apart into 絵 and 世", async () => {
    expect(await selected("遅えよ", "「……", "」とつぶやく")).toEqual(["え", "よ"]);
  });
});
