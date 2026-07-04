import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type * as SQLite from "expo-sqlite";
import {
  canonicalStem,
  extractAssocWords,
  rebuildAllAssociations,
  updateAssociationsForNote,
  getAssociationsForWordAsync,
} from "./primitive-associations";

/** Adapt better-sqlite3 to the expo-sqlite async methods these helpers use. */
function asyncAdapter(d: Database.Database): SQLite.SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      d.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).run(...params),
    withTransactionAsync: async (cb: () => Promise<void>) => {
      d.exec("BEGIN");
      try {
        await cb();
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;
}

let userRaw: Database.Database;
let strokesRaw: Database.Database;
let userDb: SQLite.SQLiteDatabase;
let strokesDb: SQLite.SQLiteDatabase;

beforeEach(() => {
  userRaw = new Database(":memory:");
  userRaw.exec(`
    CREATE TABLE user_kanji_notes (literal TEXT PRIMARY KEY, mnemonic TEXT, keyword TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE primitive_note_assoc (literal TEXT NOT NULL, word TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (literal, word, target));
    INSERT INTO user_kanji_notes (literal, mnemonic, deleted_at) VALUES
      ('宣', 'I proclaim in my home', NULL),
      ('安', 'a woman relaxing at home', NULL);
  `);
  strokesRaw = new Database(":memory:");
  strokesRaw.exec(`
    CREATE TABLE kanji_primitives (literal TEXT, position INTEGER, glyph TEXT, primitive_id INTEGER, keyword TEXT, is_primitive INTEGER);
    INSERT INTO kanji_primitives VALUES
      ('宣', 0, NULL, 51, 'house', 1),
      ('宣', 1, '亘', NULL, 'span', 0),
      ('安', 0, NULL, 51, 'house', 1),
      ('安', 1, '女', NULL, 'woman', 0);
  `);
  userDb = asyncAdapter(userRaw);
  strokesDb = asyncAdapter(strokesRaw);
});

afterEach(() => {
  userRaw.close();
  strokesRaw.close();
});

describe("canonicalStem / extractAssocWords", () => {
  it("folds inflections to a base stem", () => {
    expect(canonicalStem("relaxing")).toBe("relax");
    expect(canonicalStem("relaxes")).toBe("relax");
  });

  it("collapses inflected and base forms of silent-e roots to the same key", () => {
    // The bug this guards: shortest-stem would give make→make but making→mak.
    for (const [a, b] of [
      ["make", "making"],
      ["close", "closed"],
      ["close", "closing"],
      ["move", "moved"],
      ["house", "houses"],
      ["rule", "ruled"],
    ]) {
      expect(canonicalStem(a)).toBe(canonicalStem(b));
    }
  });

  it("drops stop words and short tokens, dedupes", () => {
    const words = extractAssocWords("a woman relaxing at home");
    expect(words).toContain("relax");
    expect(words).toContain("woman");
    expect(words).toContain(canonicalStem("home"));
    expect(words).not.toContain("at");
    expect(words).not.toContain("a");
  });
});

describe("rebuildAllAssociations + getAssociationsForWordAsync", () => {
  it("associates a word with primitive targets across stories, ranked by distinct kanji", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    // "home" appears in both 宣 and 安, which both contain the house primitive (p51).
    const home = await getAssociationsForWordAsync(userDb, "home");
    expect(home.get("p51")).toBe(2);
    expect(home.get("亘")).toBe(1); // span, only in 宣
    expect(home.get("女")).toBe(1); // woman, only in 安
  });

  it("excludeLiteral omits the kanji being edited", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    const home = await getAssociationsForWordAsync(userDb, "home", "宣");
    expect(home.get("p51")).toBe(1); // only 安 remains
    expect(home.has("亘")).toBe(false);
  });

  it("matches inflected query words via the shared stem", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    // stored "relaxing" → stem "relax"; querying "relaxes" also stems to "relax".
    const relax = await getAssociationsForWordAsync(userDb, "relaxes");
    expect(relax.get("p51")).toBe(1); // 安 contains house
  });
});

describe("updateAssociationsForNote", () => {
  it("replaces a single note's rows without touching others", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    await updateAssociationsForNote(userDb, strokesDb, "宣", "just a shrine now");
    const home = await getAssociationsForWordAsync(userDb, "home");
    expect(home.get("p51")).toBe(1); // 宣 no longer mentions home; 安 still does
    const shrine = await getAssociationsForWordAsync(userDb, "shrine");
    expect(shrine.get("p51")).toBe(1); // 宣's new words indexed
  });

  it("clears rows when a note is deleted (null mnemonic)", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    await updateAssociationsForNote(userDb, strokesDb, "安", null);
    const home = await getAssociationsForWordAsync(userDb, "home");
    expect(home.get("p51")).toBe(1); // only 宣 remains
  });

  it("does not wipe existing rows when strokesDb is unavailable", async () => {
    await rebuildAllAssociations(userDb, strokesDb);
    // Editing 宣 while the strokes tier isn't loaded must NOT destroy its associations.
    await updateAssociationsForNote(userDb, null, "宣", "some new text");
    const home = await getAssociationsForWordAsync(userDb, "home");
    expect(home.get("p51")).toBe(2); // both 宣 and 安 still counted
  });
});
