import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type * as SQLite from "expo-sqlite";
import {
  getPrimitivesForKanjiAsync,
  getPrimitiveAsync,
  getKanjiUsingPrimitiveAsync,
  getSynonymsForKeywordAsync,
} from "./kanji-search";

let raw: Database.Database;
let db: SQLite.SQLiteDatabase;

/**
 * Adapt a better-sqlite3 DB to the two expo-sqlite async methods the strokes
 * query helpers use, so they can be unit-tested without an expo-sqlite runtime.
 */
function asyncAdapter(d: Database.Database): SQLite.SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      d.prepare(sql).get(...params) ?? null,
  } as unknown as SQLite.SQLiteDatabase;
}

beforeAll(() => {
  raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE kanji_primitives (
      literal TEXT NOT NULL,
      position INTEGER NOT NULL,
      glyph TEXT,
      primitive_id INTEGER,
      keyword TEXT,
      is_primitive INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE primitives (
      id INTEGER PRIMARY KEY,
      keyword TEXT,
      display_glyph TEXT,
      real_glyph TEXT,
      strokes INTEGER
    );
    CREATE TABLE keyword_synonyms (
      keyword TEXT NOT NULL,
      synonym TEXT NOT NULL
    );
    INSERT INTO keyword_synonyms (keyword, synonym) VALUES
      ('house', 'home'),
      ('house', 'dwelling'),
      ('relax', 'rest');
    INSERT INTO kanji_primitives (literal, position, glyph, primitive_id, keyword, is_primitive) VALUES
      ('宣', 1, '亘', NULL, 'span', 0),
      ('宣', 0, NULL, 51, 'house', 1),
      ('安', 0, NULL, 51, 'house', 1),
      ('安', 1, '女', NULL, 'woman', 0);
    INSERT INTO primitives (id, keyword, display_glyph, real_glyph, strokes) VALUES
      (51, 'house', '屆', NULL, 3);
  `);
  db = asyncAdapter(raw);
});

afterAll(() => raw.close());

describe("getPrimitivesForKanjiAsync", () => {
  it("returns components in position order with types mapped", async () => {
    const result = await getPrimitivesForKanjiAsync(db, "宣");
    expect(result).toEqual([
      {
        position: 0,
        glyph: null,
        primitiveId: 51,
        keyword: "house",
        isPrimitive: true,
        displayGlyph: "屆",
      },
      {
        position: 1,
        glyph: "亘",
        primitiveId: null,
        keyword: "span",
        isPrimitive: false,
        displayGlyph: null,
      },
    ]);
  });

  it("returns [] for a kanji with no decomposition", async () => {
    expect(await getPrimitivesForKanjiAsync(db, "一")).toEqual([]);
  });
});

describe("getKanjiUsingPrimitiveAsync", () => {
  it("returns distinct literals of kanji using the primitive", async () => {
    const result = await getKanjiUsingPrimitiveAsync(db, 51);
    expect(result.sort()).toEqual(["安", "宣"]);
  });

  it("returns [] for an unused primitive id", async () => {
    expect(await getKanjiUsingPrimitiveAsync(db, 9999)).toEqual([]);
  });
});

describe("getSynonymsForKeywordAsync", () => {
  it("returns synonyms for a keyword (forward)", async () => {
    const result = await getSynonymsForKeywordAsync(db, "house");
    expect(result.sort()).toEqual(["dwelling", "home"]);
  });

  it("resolves bidirectionally and is case-insensitive", async () => {
    expect(await getSynonymsForKeywordAsync(db, "HOME")).toEqual(["house"]);
  });

  it("returns [] for a keyword with no synonyms", async () => {
    expect(await getSynonymsForKeywordAsync(db, "span")).toEqual([]);
  });
});

describe("getPrimitiveAsync", () => {
  it("returns a primitive by id", async () => {
    expect(await getPrimitiveAsync(db, 51)).toEqual({
      id: 51,
      keyword: "house",
      displayGlyph: "屆",
      realGlyph: null,
      strokes: 3,
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await getPrimitiveAsync(db, 9999)).toBeNull();
  });
});
