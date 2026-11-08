/**
 * Words saved from the reader on 2026-11-08 that then showed no highlight.
 *
 * Each case does what the device does: tap the word, bookmark the entry the tap
 * returned, then ask the matcher where it would paint. Nine words were reported
 * and eight of them are not painted anywhere, for two unrelated reasons that
 * these tests separate.
 *
 * Both are deliberate rules meeting a case they were not written for, so the
 * answers are pinned rather than asserted as correct — see
 * docs/reader-lookup-decisions.md, "A kanji word's kana reading loses to the
 * word the characters already spell" and "A bookmark is painted where it was
 * confirmed".
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, EXT_DB_PATH, hasBothDbs } from "../../../test/dictionary-db";
import { analyseHtmlForBookmarks, matchBookmarksInHtml, segmentRun } from "./bookmarks";
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

/** Tap `word` in `text`, save what came back, and report what gets painted. */
async function paintedAfterSaving(text: string, word: string): Promise<string[]> {
  const [top] = await smartLookupWithOffset(text, text.indexOf(word), wrap(dict!), wrap(ext!));
  const saved = new Set((top?.entries ?? []).map((e) => e.id));
  const match = await matchBookmarksInHtml(wrap(dict!), `<p>${text}</p>`, {
    version: "test",
    hasEntryId: (id) => saved.has(id),
  });
  return match.placements.flatMap((p) =>
    p.spans.map(([start, len]) => p.run.slice(start, start + len)),
  );
}

describe.skipIf(!hasBothDbs)("a word the page writes in kana is never painted", () => {
  /**
   * `matchAnalysedBookmarks` drops a kana match of an entry the dictionary also
   * writes in kanji, unless an inflection was undone. The rule exists so that a
   * bookmarked 事 does not light up every こと — but it fires on any word the
   * page happens to spell in kana, and this novel spells most of its adverbs
   * that way. Seven of the nine reported words land here.
   *
   * `uk` ("usually written in kana") does not separate them: 事 carries it too,
   * and 襖 and 取り繕う do not carry it and are still dropped.
   */
  const SAVED_IN_KANA: Record<string, { text: string; word: string }> = {
    くくる: { text: "そういう言葉でくくることに何の意味があるのか。", word: "くくる" },
    かえって: {
      text: "その無関心さがかえって不思議な居心地のよさをかもしだしていた。",
      word: "かえって",
    },
    ふすま: { text: "障子やふすまでさえも、閉めていると", word: "ふすま" },
    すなわち: { text: "すなわち——俺とは簡単に寝ないこと。", word: "すなわち" },
    せいぜい: { text: "言えることはせいぜいひとつしかない。", word: "せいぜい" },
    よほど: { text: "今夜の俺はよほど頼りなく見えたらしい。", word: "よほど" },
    とりつくろう: { text: "その場を適当にとりつくろうこともできない", word: "とりつくろう" },
  };
  for (const [name, c] of Object.entries(SAVED_IN_KANA)) {
    it(`${name} is saved and painted nowhere`, async () => {
      expect(await paintedAfterSaving(c.text, c.word)).toEqual([]);
    });
  }

  it("the same words written in kanji are painted", async () => {
    expect(
      await paintedAfterSaving("そういう言葉で括ることに何の意味があるのか。", "括る"),
    ).toEqual(["括る"]);
    expect(await paintedAfterSaving("障子や襖でさえも、閉めていると", "襖")).toEqual(["襖"]);
  });

  it("the segmenter is not what stops them — it confirms ふすま", async () => {
    const analysis = await analyseHtmlForBookmarks(
      wrap(dict!),
      "<p>障子やふすまでさえも、閉めていると</p>",
    );
    expect(analysis.confirmed.has("ふすま")).toBe(true);
  });
});

describe.skipIf(!hasBothDbs)("a bookmark un-placed by text elsewhere in the run", () => {
  /**
   * The eighth word, 植物, is written in kanji and so clears the rule above. It
   * is dropped by the other gate — "the characters have to be a word HERE".
   *
   * `segmentRun` is a whole-run DP maximising the sum of squared segment
   * lengths, and `best[i]` depends on the entire suffix after `i`. 物の名 and
   * 前に are both real entries, and 9 + 4 beats 物 + の + 名前 at 1 + 1 + 4, so
   * adding 「に詳しかった」 to the end of the sentence moves a boundary at the
   * start of it and destroys 植物. The same deficiency as the tap's kana-run
   * junk — no part-of-speech or connection costs — but in the painter.
   */
  const isWord = (surface: string) =>
    !!dict!
      .prepare(
        `SELECT 1 FROM kanji WHERE text = ? UNION ALL SELECT 1 FROM kana WHERE text = ? LIMIT 1`,
      )
      .get(surface, surface);

  const split = (text: string): string[] => {
    const parts: string[] = [];
    let at = 0;
    for (const length of segmentRun([...text], isWord)) {
      parts.push(text.slice(at, at + length));
      at += length;
    }
    return parts;
  };

  it("splits 植物 off correctly on its own", () => {
    expect(split("植物の名前だ。")).toEqual(["植物", "の", "名前", "だ", "。"]);
  });

  it("loses the boundary once the sentence continues", () => {
    expect(split("植物の名前に詳しかった。")).toEqual([
      "植",
      "物の名",
      "前に",
      "詳",
      "し",
      "かっ",
      "た",
      "。",
    ]);
  });

  it("so the saved word is painted in one sentence and not the other", async () => {
    expect(await paintedAfterSaving("植物の名前だ。", "植物")).toEqual(["植物"]);
    expect(await paintedAfterSaving("夏姫さんは植物の名前に詳しかった。", "植物")).toEqual([]);
  });
});

describe.skipIf(!hasBothDbs)("controls: words that do paint on those same pages", () => {
  it("paints 無関心, 障子 and 至るまで", async () => {
    expect(
      await paintedAfterSaving(
        "その無関心さがかえって不思議な居心地のよさをかもしだしていた。",
        "無関心",
      ),
    ).toEqual(["無関心"]);
    expect(await paintedAfterSaving("障子やふすまでさえも、閉めていると", "障子")).toEqual([
      "障子",
    ]);
    expect(
      await paintedAfterSaving("組んだ脚はつま先に至るまですっきりと伸び、", "至るまで"),
    ).toEqual(["至るまで"]);
  });
});
