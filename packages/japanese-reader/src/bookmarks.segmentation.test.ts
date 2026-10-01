/**
 * Where the words are.
 *
 * The highlighter proposes a span whenever some substring deinflects onto a
 * bookmarked entry, which in a dictionary of 170,000 entries is nearly
 * everywhere. `segmentRun` is what refuses the ones the page does not say:
 * からず is a real negative of 刈る, and 会ってからずっと does not contain it.
 */

import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import { segmentRun } from "./bookmarks";
import { ANY_TYPE_MASK, deinflect, posTagsToTypeMask } from "./deinflect";

const db = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;
afterAll(() => db?.close());

/** The same word test the matcher applies, built straight from the tables. */
const classes = new Map<string, number>();
function wordClasses(word: string): number {
  const hit = classes.get(word);
  if (hit != null) return hit;
  const rows = db!
    .prepare(
      `SELECT s.part_of_speech p FROM senses s WHERE s.entry_id IN
         (SELECT entry_id FROM kanji WHERE text=? UNION SELECT entry_id FROM kana WHERE text=?)`,
    )
    .all(word, word) as { p: string | null }[];
  let mask = rows.length > 0 ? 0 : -1;
  for (const row of rows) mask |= posTagsToTypeMask(JSON.parse(row.p ?? "[]") as string[]);
  classes.set(word, mask);
  return mask;
}

function isWord(surface: string): boolean {
  return deinflect(surface).some((candidate) => {
    const mask = wordClasses(candidate.word);
    if (mask === -1) return false;
    if (candidate.reasons.length === 0) return true;
    return candidate.entryMask === ANY_TYPE_MASK || (candidate.entryMask & mask) !== 0;
  });
}

function tokens(text: string): string[] {
  const run = [...text];
  const out: string[] = [];
  let at = 0;
  for (const length of segmentRun(run, isWord)) {
    out.push(run.slice(at, at + length).join(""));
    at += length;
  }
  return out;
}

describe.skipIf(!hasDictDb)("segmentRun", () => {
  it("splits the sentences the walked page was wrong about", () => {
    // Each of these was a wrong highlight: からず, 緒, おい/しい, 欲し/かった,
    // かし, ひた, けれ, はい, だち.
    expect(tokens("会ってからずっと喋っている")).toEqual([
      "会って",
      "から",
      "ずっと",
      "喋っている",
    ]);
    expect(tokens("友達と一緒に出かける")).toContain("一緒に");
    expect(tokens("ネットでおいしい店を調べる")).toContain("おいしい");
    expect(tokens("こういう女友だちが欲しかった")).toEqual([
      "こういう",
      "女友だち",
      "が",
      "欲しかった",
    ]);
    expect(tokens("何かしら理由がある")).toContain("何かしら");
    expect(tokens("朝からひたすら歩き続けた")).toContain("ひたすら");
    // だけれ ties with けれど here and wins on length, which is wrong about
    // the grammar and right about the highlight: けれ is not a token either
    // way, so the imperative of 蹴る is refused.
    expect(tokens("面倒だけれど")).not.toContain("けれ");
  });

  it("keeps the words the page does say", () => {
    expect(tokens("死ぬ二三日前台所で宙返りをし")).toContain("台所");
    expect(tokens("毎朝ウォーキングに励み")).toContain("励み");
    // 汗にして流し, as the page has it — 汗を流す is an idiom of its own
    // and would, correctly, swallow the 流し inside it.
    expect(tokens("汗にして流し")).toContain("流し");
    expect(tokens("夜更けまで話し込んだ")).toContain("夜更け");
    expect(tokens("年の差とは関係なく互いに引かれあう")).toContain("互いに");
  });

  /**
   * Longest-match alone reads からず as a word, because it is one. Scoring a
   * token by the square of its length is what makes から + ずっと the better
   * split, and a tie goes to the longer token so that 台所 + で beats
   * 台 + 所で.
   */
  it("prefers few long words over many short ones, and the longer on a tie", () => {
    expect(tokens("からずっと")).toEqual(["から", "ずっと"]);
    expect(tokens("台所で")).toEqual(["台所", "で"]);
  });

  it("crosses a character that is no word at all", () => {
    expect(tokens("〆台所")).toEqual(["〆", "台所"]);
  });
});
