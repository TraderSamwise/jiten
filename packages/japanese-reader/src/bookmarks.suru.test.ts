/**
 * A noun that takes する keeps its own extent when the reader highlights it:
 * 勧誘される is marked on 勧誘, because the word saved was the noun and the
 * conjugation is not part of it. A verb whose inflection is fused into the
 * word — のめり込む on のめりこんだ, 記す on 記した — stays marked whole.
 */
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import type { ReaderSqlDb } from "./backend";
import { applyResolvedBookmarkHighlightsToHtml } from "./bookmarks";

const describeWithDb = hasDictDb ? describe : describe.skip;

describeWithDb("suru-verb highlights keep the noun's extent", () => {
  let raw: Database.Database;
  let dictDb: ReaderSqlDb;

  beforeAll(() => {
    raw = new Database(DICT_DB_PATH, { readonly: true });
    dictDb = {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? raw.prepare(sql).all(...(params as never[])) : raw.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? raw.prepare(sql).get(...(params as never[])) : raw.prepare(sql).get()) as T) ??
        null,
    };
  });

  afterAll(() => raw.close());

  const entryIdFor = (word: string) =>
    (
      raw
        .prepare(
          "SELECT entry_id FROM kanji WHERE text = ? UNION SELECT entry_id FROM kana WHERE text = ? LIMIT 1",
        )
        .get(word, word) as { entry_id: number } | undefined
    )?.entry_id;

  const marked = async (word: string, html: string) => {
    const id = entryIdFor(word);
    expect(id, `no entry for ${word}`).toBeDefined();
    const out = await applyResolvedBookmarkHighlightsToHtml(dictDb, html, {
      version: "v",
      hasEntryId: (candidate) => candidate === id,
    });
    return [...out.matchAll(/<span class="bookmarked-word">([^<]*)<\/span>/g)].map((m) => m[1]);
  };

  it("marks only the noun of a suru verb", async () => {
    expect(await marked("勧誘", "<p>に進み、勧誘されるまでもなく</p>")).toEqual(["勧誘"]);
    expect(await marked("退団", "<p>退団したあと苦労する</p>")).toEqual(["退団"]);
  });

  it("marks a fused inflection whole", async () => {
    expect(await marked("のめり込む", "<p>他人の人生にのめりこんだ。</p>")).toEqual([
      "のめりこんだ",
    ]);
    expect(await marked("記す", "<p>連絡先を記した。説明は</p>")).toEqual(["記した"]);
  });

  it("still marks the plain dictionary form", async () => {
    expect(await marked("表札", "<p>並んだ表札を、見られたくなかった</p>")).toEqual(["表札"]);
  });

  /** No cap: the set size never decides whether inflection is undone. */
  it("deinflects however many entries are bookmarked", async () => {
    const id = entryIdFor("勧誘");
    const everything = { version: "v", hasEntryId: (candidate: number) => candidate === id };
    const out = await applyResolvedBookmarkHighlightsToHtml(
      dictDb,
      "<p>に進み、勧誘されるまでもなく</p>",
      everything,
    );
    expect(out).toContain('<span class="bookmarked-word">勧誘</span>');
  });
});

describeWithDb("the trim is only for する, and does not bypass the kana guard", () => {
  let raw: Database.Database;
  let dictDb: ReaderSqlDb;

  beforeAll(() => {
    raw = new Database(DICT_DB_PATH, { readonly: true });
    dictDb = {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? raw.prepare(sql).all(...(params as never[])) : raw.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? raw.prepare(sql).get(...(params as never[])) : raw.prepare(sql).get()) as T) ??
        null,
    };
  });

  afterAll(() => raw.close());

  const idOf = (word: string) =>
    (
      raw
        .prepare(
          "SELECT entry_id FROM kanji WHERE text = ? UNION SELECT entry_id FROM kana WHERE text = ? LIMIT 1",
        )
        .get(word, word) as { entry_id: number } | undefined
    )?.entry_id;

  const marked = async (word: string, html: string) => {
    const id = idOf(word);
    const out = await applyResolvedBookmarkHighlightsToHtml(dictDb, html, {
      version: "v",
      hasEntryId: (candidate) => candidate === id,
    });
    return [...out.matchAll(/<span class="bookmarked-word">([^<]*)<\/span>/g)].map((m) => m[1]);
  };

  /** ている leaves a prefix too; trimming on that cuts 当|てる out of 当てる. */
  it("does not cut an ichidan verb written 〜てる", async () => {
    expect(await marked("当て", "<p>見当てるのは</p>")).not.toContain("当て");
  });

  /**
   * ことにする trims to ことに, which is the kana of 殊に. Marked as not
   * inflected, so the kana guard still refuses it and every ことに on the page
   * stays unlit.
   */
  it("does not light a bare kana reading reached by trimming", async () => {
    expect(await marked("殊に", "<p>ことにするのは、ことに難しい</p>")).toEqual([]);
  });
});
