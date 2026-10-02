/**
 * @vitest-environment jsdom
 *
 * Two invariants nothing else would catch.
 *
 * The matcher and the painter agree on where a bookmark goes only because
 * they agree, character for character, on what a run IS — and the painter
 * carries its own copy of that rule, because the webview bundle has no
 * dependencies. A drift between the two copies would not fail a test; it
 * would silently stop every placement from being found.
 *
 * And a surface the matcher accepts must have somewhere to be painted. The
 * accept loop and the placements come from two different passes, so a future
 * guard could admit a surface that `confirmRuns` never recorded an occurrence
 * for, and it would simply never appear on the page.
 */
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterAll, describe, expect, it } from "vitest";

import { DICT_DB_PATH, hasDictDb } from "../../../test/dictionary-db";
import { matchBookmarksInHtml } from "./bookmarks";

const WEBVIEW_SRC = resolve(__dirname, "../../reader-webview/src/bookmarks.ts");
const MATCHER_SRC = resolve(__dirname, "bookmarks.ts");

/** The body of the predicate, with its name and whitespace taken out. */
function predicateBody(path: string): string {
  const src = readFileSync(path, "utf-8");
  const at = src.indexOf("function isJapaneseTextChar(ch: string): boolean {");
  expect(at, `isJapaneseTextChar missing from ${path}`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("\n}", at)).replace(/\s+/g, "");
}

describe("the painter's copy of the run rule", () => {
  it("is the same rule the matcher uses", () => {
    expect(predicateBody(WEBVIEW_SRC)).toBe(predicateBody(MATCHER_SRC));
  });
});

const db = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;
afterAll(() => db?.close());

const dictDb = {
  async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return db!.prepare(sql).all(...(params ?? [])) as T[];
  },
  async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
    return (db!.prepare(sql).get(...(params ?? [])) as T) ?? null;
  },
};

const HTML =
  "<p>毎朝ウォーキングに励み、体を動かす。</p>" +
  "<p>勧誘されたが断った。岩盤浴に行く。</p>" +
  "<p>つい笑ってしまった。その件について話をした。</p>";

async function painted(hasEntryId: (id: number) => boolean) {
  const { provenance, placements } = await matchBookmarksInHtml(dictDb, HTML, {
    version: `invariants:${hasEntryId.name}`,
    hasEntryId,
  });
  const surfaces = new Set<string>();
  for (const placement of placements) {
    for (const [start, length] of placement.spans) {
      surfaces.add(placement.run.slice(start, start + length));
    }
  }
  return { accepted: [...provenance.keys()], painted: surfaces };
}

describe.skipIf(!hasDictDb)("every accepted surface has somewhere to be painted", () => {
  /**
   * Not "is painted": a longer accepted surface starting at the same
   * character takes the place, and 岩盤浴 should beat 岩盤 when both are
   * saved. What must never happen is a surface the accept loop admitted and
   * `confirmRuns` recorded no occurrence for — that one can only be a prefix
   * of a painted span by accident.
   */
  it("paints each accepted surface, or a longer one over it", async () => {
    const { accepted, painted: shown } = await painted(function all() {
      return true;
    });
    expect(accepted.length).toBeGreaterThan(0);

    const unexplained = accepted.filter(
      (surface) => !shown.has(surface) && ![...shown].some((span) => span.startsWith(surface)),
    );
    expect(unexplained).toEqual([]);
  });

  /** And the shorter one is painted as soon as the longer is not saved. */
  it("paints a compound head when the compound itself is not saved", async () => {
    const { painted: shown } = await painted(function justIwaban(id: number) {
      return id === 1217400;
    });
    expect([...shown]).toContain("岩盤");
  });
});
