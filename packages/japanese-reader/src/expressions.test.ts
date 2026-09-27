import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExpressionIndex, findExpressions, type ExpressionIndex } from "./expressions";
import type { ReaderSqlDb } from "./backend";
import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";

function wrap(db: Database.Database): ReaderSqlDb {
  return {
    getAllAsync: async <T>(sql: string, params?: unknown[]) =>
      (params ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as T[],
    getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
      ((params ? db.prepare(sql).get(...(params as never[])) : db.prepare(sql).get()) as T) ?? null,
  };
}

describe.skipIf(!hasDictDb)("findExpressions", () => {
  let raw: Database.Database;
  let index: ExpressionIndex;

  beforeAll(async () => {
    raw = new Database(DICT_DB_PATH, { readonly: true });
    index = await buildExpressionIndex(wrap(raw));
  });

  afterAll(() => raw.close());

  const found = (text: string) => findExpressions(text, index).map((m) => `${m.form}|${m.surface}`);

  it("indexes a useful share of the dictionary's expressions", () => {
    expect(index.size).toBeGreaterThan(10_000);
    expect(index.byAnchor.size).toBeGreaterThan(5_000);
  });

  it("finds an expression written exactly as the dictionary spells it", () => {
    expect(found("腹が立つほどだった")).toContain("腹が立つ|腹が立つ");
  });

  /** が on a relative-clause subject becomes の — the 目の玉 case from the reader. */
  it("matches a relative-clause の where the entry has が", () => {
    expect(found("目の玉の飛び出るような値段だった")).toContain(
      "目の玉が飛び出る|目の玉の飛び出る",
    );
  });

  it("matches に and へ interchangeably", () => {
    expect(found("絵でもかいて展覧会へ出したらよかろう")).toContain(
      "展覧会に出す|展覧会へ出したら",
    );
  });

  /**
   * 入る/入れる and 開く/開ける are transitivity pairs, and the transitive is
   * spelled like the intransitive's potential, so the deinflector reaches the
   * wrong half. Refusing a potential chain keeps literal use out.
   */
  it("does not read a transitive verb as the intransitive's potential", () => {
    expect(found("三円を蝦蟇口へ入れて懐へ入れた")).not.toContain("口に入る|口へ入れて");
    expect(found("箱の口を開けて手拭を出した")).not.toContain("口を開く|口を開けて");
  });

  it("does not start a phrase inside a longer compound", () => {
    // 冷汗 is one word; the 汗 in it is not the 汗 of 汗を流す.
    expect(found("そこには冷汗を流した")).not.toContain("汗を流す|汗を流した");
    expect(found("寝小便をした事まで持ち出す")).not.toContain("小便をする|小便をした");
  });

  it("matches は and も standing in for each other", () => {
    // JMdict lists 役にも立たない but not 役には立たない; the swap reaches it.
    expect(found("役には立たない代物だ")).toContain("役にも立たない|役には立たない");
  });

  it("matches a phrase whose verb is inflected", () => {
    expect(found("腹が立ったので帰った")).toContain("腹が立つ|腹が立った");
    expect(found("頭を下げなければならない")).toContain("頭を下げる|頭を下げなければ");
    expect(found("飯を食っていたら来た")).toContain("飯を食う|飯を食っていたら");
  });

  it("does not swap a particle whose case would change the meaning", () => {
    // うちの人 is "my husband"; うちが人 is not the same phrase.
    expect(found("うちが人を呼んだ")).not.toContain("うちの人|うちが人");
  });

  it("does not match a phrase whose literal kana are absent", () => {
    // あかの他人 is the phrase; 他人 on its own is not it.
    expect(found("彼は他人だと言った")).not.toContain("あかの他人|他人");
  });

  it("returns non-overlapping spans, longest first", () => {
    const matches = findExpressions("目の玉の飛び出るような値段で腹が立った", index);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].start + matches[i - 1].length);
    }
  });

  it("reports offsets that address the span in the original text", () => {
    const text = "その値段は目の玉の飛び出るようなものだった";
    const [match] = findExpressions(text, index).filter((m) => m.form === "目の玉が飛び出る");
    expect(match).toBeDefined();
    expect(text.slice(match.start, match.start + match.length)).toBe(match.surface);
  });

  /** One kanji is still an anchor when paired with the kana before it. */
  it("finds a phrase with only one kanji in it", () => {
    expect(found("あぐらを掻いて座った")).toContain("あぐらを掻く|あぐらを掻いて");
    expect(found("しらを切るつもりだ")).toContain("しらを切る|しらを切る");
    expect(found("けちを付けると同じ事だ")).toContain("けちを付ける|けちを付ける");
  });

  /**
   * The masu-stem rule turns any verb into itself-plus-one-kana, so it will
   * happily eat the first character of the next word: 馬鹿にされていけない is
   * 馬鹿にされて followed by いけない, not 馬鹿にされてい.
   */
  it("does not run one character past the end of the phrase", () => {
    const [match] = findExpressions("どうも人に馬鹿にされていけない", index).filter(
      (m) => m.form === "馬鹿にする",
    );
    expect(match?.surface).toBe("馬鹿にされて");
  });

  it("keeps the whole inflected tail when it belongs to the phrase", () => {
    expect(found("うちへ帰って飯を食っていたら来た")).toContain("飯を食う|飯を食っていたら");
  });

  it("finds nothing in text with no expressions", () => {
    expect(findExpressions("ここにはなにもない", index)).toEqual([]);
  });
});
