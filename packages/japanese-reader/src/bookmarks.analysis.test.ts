/**
 * Saving a word should repaint the page, not re-read it.
 *
 * Nearly the whole cost of a match is working out what the page COULD say —
 * deinflecting every substring of it and asking the dictionary about each —
 * and none of that changes when a bookmark is added or removed. These pin the
 * split: the analysis is taken once, and matching against it afterwards asks
 * the dictionary nothing.
 */
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import { analyseHtmlForBookmarks, matchAnalysedBookmarks, matchBookmarksInHtml } from "./bookmarks";

const db = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;
afterAll(() => db?.close());

function countingDb() {
  let queries = 0;
  return {
    get queries() {
      return queries;
    },
    db: {
      async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
        queries++;
        return db!.prepare(sql).all(...(params ?? [])) as T[];
      },
      async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
        queries++;
        return (db!.prepare(sql).get(...(params ?? [])) as T) ?? null;
      },
    },
  };
}

const HTML = "<p>毎朝ウォーキングに励み、体を動かす。岩盤浴にも通い、お茶を飲む。</p>";
const HAGEMU = 1557390;
const KAYOU = 1432850;

describe.skipIf(!hasDictDb)("analysis and match", () => {
  it("asks the dictionary nothing once the page has been read", async () => {
    const counting = countingDb();
    const analysis = await analyseHtmlForBookmarks(counting.db, HTML);
    const afterReading = counting.queries;
    expect(afterReading).toBeGreaterThan(0);

    matchAnalysedBookmarks(analysis, { version: "a", hasEntryId: (id) => id === HAGEMU });
    matchAnalysedBookmarks(analysis, { version: "b", hasEntryId: (id) => id === KAYOU });

    expect(counting.queries).toBe(afterReading);
  });

  it("gives the same answer as reading the page each time", async () => {
    const counting = countingDb();
    const analysis = await analyseHtmlForBookmarks(counting.db, HTML);

    for (const entryId of [HAGEMU, KAYOU]) {
      const bookmarks = { version: `v${entryId}`, hasEntryId: (id: number) => id === entryId };
      const cached = matchAnalysedBookmarks(analysis, bookmarks);
      const fresh = await matchBookmarksInHtml(counting.db, HTML, bookmarks);
      expect([...cached.provenance.keys()]).toEqual([...fresh.provenance.keys()]);
      expect(cached.placements).toEqual(fresh.placements);
    }
  });

  it("answers a different bookmark set differently", async () => {
    const analysis = await analyseHtmlForBookmarks(countingDb().db, HTML);
    const one = matchAnalysedBookmarks(analysis, {
      version: "a",
      hasEntryId: (id) => id === HAGEMU,
    });
    const other = matchAnalysedBookmarks(analysis, {
      version: "b",
      hasEntryId: (id) => id === KAYOU,
    });
    expect([...one.provenance.keys()]).toEqual(["励み"]);
    expect([...other.provenance.keys()]).toEqual(["通い"]);
  });

  it("has nothing to say about a page with no Japanese in it", async () => {
    const analysis = await analyseHtmlForBookmarks(countingDb().db, "<p>hello</p>");
    const match = matchAnalysedBookmarks(analysis, { version: "a", hasEntryId: () => true });
    expect(match.provenance.size).toBe(0);
    expect(match.placements).toEqual([]);
  });
});
