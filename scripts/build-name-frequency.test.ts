/**
 * The split is the only place this script can be wrong without saying so: a
 * bad boundary invents a (spelling, reading) pair that then outranks a real
 * one. These pin the rule that a split counts only when JMnedict already holds
 * both halves, and that an undecidable row contributes nothing.
 */
import { describe, expect, it } from "vitest";
import { parseTsv, splitNameRow } from "./build-name-frequency";

/** Stands in for the names table; only these pairs exist. */
const table = (...pairs: string[]) => {
  const held = new Set(pairs);
  return (kanji: string, kana: string) => held.has(`${kanji}\t${kana}`);
};

describe("splitNameRow", () => {
  it("splits where both halves are known names", () => {
    const has = table("松山\tまつやま", "千春\tちはる");
    expect(splitNameRow("松山千春", "まつやま ちはる", has)).toEqual({
      kind: "pair",
      pairs: [
        ["松山", "まつやま"],
        ["千春", "ちはる"],
      ],
    });
  });

  it("finds the boundary wherever it falls, not at the midpoint", () => {
    const has = table("五十嵐\tいがらし", "大\tだい");
    expect(splitNameRow("五十嵐大", "いがらし だい", has)).toMatchObject({
      kind: "pair",
      pairs: [
        ["五十嵐", "いがらし"],
        ["大", "だい"],
      ],
    });
  });

  it("ignores a space already in the label", () => {
    const has = table("福尾\tふくお", "亮\tりょう");
    expect(splitNameRow("福尾 亮", "ふくお りょう", has)).toMatchObject({ kind: "pair" });
  });

  it("refuses a pen name, whose reading is not its spelling", () => {
    // 石崎 寿夫 reads すしお as a pen name: no boundary makes both halves fit.
    const has = table("石崎\tいしざき", "寿夫\tとしお");
    expect(splitNameRow("石崎寿夫", "すしお", has)).toEqual({ kind: "malformed" });
  });

  it("says nothing when two boundaries both fit", () => {
    const has = table("泉\tいずみ", "美幸\tみゆき", "泉美\tいずみ", "幸\tみゆき");
    expect(splitNameRow("泉美幸", "いずみ みゆき", has)).toEqual({ kind: "ambiguous" });
  });

  it("reports no-split rather than guessing when neither half is known", () => {
    expect(splitNameRow("山田太郎", "やまだ たろう", table())).toEqual({ kind: "no-split" });
  });

  it("counts a mononym only when the table holds it", () => {
    expect(splitNameRow("杏子", "きょうこ", table("杏子\tきょうこ"))).toEqual({
      kind: "mono",
      pairs: [["杏子", "きょうこ"]],
    });
    expect(splitNameRow("杏子", "きょうこ", table())).toEqual({ kind: "malformed" });
  });

  it("rejects a reading that is not kana", () => {
    const has = table("松山\tまつやま", "千春\tちはる");
    expect(splitNameRow("松山千春", "Matsuyama Chiharu", has)).toEqual({ kind: "malformed" });
    expect(splitNameRow("松山千春", "まつやま 千春", has)).toEqual({ kind: "malformed" });
  });

  it("rejects a name in three parts, whose boundaries this cannot place", () => {
    const has = table("徳川\tとくがわ", "家康\tいえやす");
    expect(splitNameRow("徳川家康", "とく がわ いえやす", has)).toEqual({ kind: "malformed" });
  });

  it("never emits a pair the table does not already hold", () => {
    // The guarantee the whole approach rests on: counts rank readings that
    // exist, and cannot introduce one.
    const has = table("中村\tなかむら", "正人\tまさと");
    const outcome = splitNameRow("中村正人", "なかむら まさと", has);
    if (outcome.kind !== "pair") throw new Error("expected a pair");
    for (const [kanji, kana] of outcome.pairs) expect(has(kanji, kana)).toBe(true);
  });
});

describe("parseTsv", () => {
  it("strips Wikidata's quoting and language tags", () => {
    const rows = parseTsv('?l\t?kana\n"松山千春"@ja\t"まつやま ちはる"\n');
    expect(rows).toEqual([{ l: "松山千春", kana: "まつやま ちはる" }]);
  });

  it("throws on an empty body rather than reporting zero rows", () => {
    // A timed-out query that parsed as "no results" would silently shrink the
    // counts, and every number downstream would still look reasonable.
    expect(() => parseTsv("")).toThrow(/empty SPARQL response/);
  });

  it("reads a header-only response as no rows", () => {
    expect(parseTsv("?c\n")).toEqual([]);
  });
});
