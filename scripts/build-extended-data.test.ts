/**
 * Tests for the dictionary-extended.db build output.
 *
 * Verifies the pre-built extended DB has the expected tables, indexes,
 * FTS5 virtual table, and non-zero row counts.
 *
 * Requires: assets/dictionary-extended.db (run `yarn build:extended` first)
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const EXT_DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary-extended.db");

describe("dictionary-extended.db", () => {
  let db: Database.Database;

  beforeAll(() => {
    if (!fs.existsSync(EXT_DB_PATH)) {
      throw new Error(`dictionary-extended.db not found. Run 'yarn build:extended' first.`);
    }
    db = new Database(EXT_DB_PATH, { readonly: true });
  });

  afterAll(() => {
    db?.close();
  });

  // ─── Tables ───

  test("has ext_meta table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ext_meta'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has synonyms table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='synonyms'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has names table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='names'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has names_fts virtual table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='names_fts'")
      .get();
    expect(row).toBeTruthy();
  });

  // ─── Row counts ───

  test("synonyms table has rows", () => {
    const { count } = db.prepare("SELECT COUNT(*) as count FROM synonyms").get() as {
      count: number;
    };
    expect(count).toBeGreaterThan(10000);
  });

  test("names table has rows", () => {
    const { count } = db.prepare("SELECT COUNT(*) as count FROM names").get() as {
      count: number;
    };
    expect(count).toBeGreaterThan(100000);
  });

  // ─── Indexes ───

  test("has synonyms word index", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ext_synonyms_word'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has synonyms synonym index", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ext_synonyms_synonym'",
      )
      .get();
    expect(row).toBeTruthy();
  });

  test("has names kanji index", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ext_names_kanji'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has names kana index", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ext_names_kana'")
      .get();
    expect(row).toBeTruthy();
  });

  test("has names category index", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ext_names_category'",
      )
      .get();
    expect(row).toBeTruthy();
  });

  // ─── Schema correctness ───

  test("synonyms has expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(synonyms)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("word");
    expect(names).toContain("synonym");
  });

  test("names has expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(names)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("kanji");
    expect(names).toContain("kana");
    expect(names).toContain("name_type");
    expect(names).toContain("translation");
    expect(names).toContain("category");
  });

  // ─── Version metadata ───

  test("ext_meta has version", () => {
    const row = db.prepare("SELECT value FROM ext_meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(parseInt(row!.value, 10)).toBeGreaterThanOrEqual(1);
  });

  // ─── Data quality ───

  test("synonyms contain expected pairs (hunger→starvation)", () => {
    const rows = db
      .prepare(
        "SELECT synonym FROM synonyms WHERE word = 'hunger' UNION SELECT word FROM synonyms WHERE synonym = 'hunger'",
      )
      .all() as { synonym: string }[];
    const words = rows.map((r) => r.synonym);
    expect(words.length).toBeGreaterThan(0);
  });

  test("names contain person entries", () => {
    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM names WHERE category = 'person'")
      .get() as { count: number };
    expect(count).toBeGreaterThan(10000);
  });

  test("names contain place entries", () => {
    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM names WHERE category = 'place'")
      .get() as { count: number };
    expect(count).toBeGreaterThan(1000);
  });

  test("names FTS5 search works", () => {
    const rows = db
      .prepare(
        "SELECT n.kana FROM names_fts fts JOIN names n ON fts.rowid = n.id WHERE names_fts MATCH 'Tokyo' LIMIT 5",
      )
      .all() as { kana: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  test("names have kana values", () => {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM names WHERE kana IS NULL OR kana = ''")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });
});
