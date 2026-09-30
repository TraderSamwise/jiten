import { describe, expect, it } from "vitest";
import { readerHighlightEntryIds } from "./reader-highlight-lists";

const lists = (pairs: [string, string[]][]) =>
  new Map(pairs.map(([key, ids]) => [key, new Set(ids)]));

describe("readerHighlightEntryIds", () => {
  const bookmarked = new Set(["e:1", "e:2", "e:3", "k:食"]);
  const byKey = lists([
    ["e:1", ["common"]],
    ["e:2", ["hardest"]],
    ["e:3", ["common", "hardest"]],
    ["k:食", ["common"]],
  ]);

  it("keeps every entry when nothing is excluded", () => {
    expect([...readerHighlightEntryIds(bookmarked, byKey, [])]).toEqual([1, 2, 3]);
  });

  it("drops the entries of an excluded list", () => {
    expect([...readerHighlightEntryIds(bookmarked, byKey, ["common"])]).toEqual([2, 3]);
  });

  /** An entry in two lists survives while either of them is included. */
  it("keeps an entry that is also in a list still included", () => {
    expect([...readerHighlightEntryIds(bookmarked, byKey, ["common"])]).toContain(3);
    expect([...readerHighlightEntryIds(bookmarked, byKey, ["common", "hardest"])]).toEqual([]);
  });

  it("ignores kanji keys", () => {
    expect([...readerHighlightEntryIds(new Set(["k:食"]), byKey, [])]).toEqual([]);
  });

  /** A list created after the setting was saved is not in the excluded set. */
  it("highlights a list nobody has excluded yet", () => {
    const withNew = new Set([...bookmarked, "e:9"]);
    const byKeyWithNew = lists(
      [...byKey.entries()].map(([k, v]) => [k, [...v]]) as [string, string[]][],
    );
    byKeyWithNew.set("e:9", new Set(["brand-new"]));
    expect([...readerHighlightEntryIds(withNew, byKeyWithNew, ["common"])]).toContain(9);
  });

  it("keeps an entry whose list membership is unknown", () => {
    expect([...readerHighlightEntryIds(new Set(["e:7"]), new Map(), ["common"])]).toEqual([7]);
  });
});
