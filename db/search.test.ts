import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";

import { getEntries, getEntry } from "./search";
import { getDisplayText, getTargetReading } from "@/lib/typing-utils";

/** Minimal dictionary schema — the tables getEntries reads. */
function createDictDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      common INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      jlpt_level INTEGER
    );
    CREATE TABLE kanji (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );
    CREATE TABLE kana (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      romaji TEXT,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      part_of_speech TEXT,
      glosses TEXT NOT NULL,
      field TEXT,
      misc TEXT,
      info TEXT
    );
    CREATE TABLE pitch_accents (
      entry_id INTEGER NOT NULL,
      reading TEXT NOT NULL,
      pitch_number INTEGER NOT NULL
    );
  `);

  const addEntry = (id: number, kanjiText: string, kanaText: string, gloss: string) => {
    d.prepare("INSERT INTO entries (id, common, priority) VALUES (?, 1, 0)").run(id);
    d.prepare("INSERT INTO kanji (entry_id, text, common) VALUES (?, ?, 1)").run(id, kanjiText);
    d.prepare("INSERT INTO kana (entry_id, text, romaji, common) VALUES (?, ?, ?, 1)").run(
      id,
      kanaText,
      null,
    );
    d.prepare("INSERT INTO senses (entry_id, part_of_speech, glosses) VALUES (?, ?, ?)").run(
      id,
      '["n"]',
      JSON.stringify([{ lang: "eng", text: gloss }]),
    );
  };

  addEntry(1000001, "政権", "せいけん", "political power");
  addEntry(1000002, "半端", "はんぱ", "incomplete");
  addEntry(1000003, "電球", "でんきゅう", "light bulb");
  return d;
}

function wrap(db: Database.Database): SQLiteDatabase {
  return {
    getAllAsync: async <T>(sql: string, params?: unknown[]) => {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]) => {
      const stmt = db.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | null;
    },
  } as unknown as SQLiteDatabase;
}

let raw: Database.Database;
let db: SQLiteDatabase;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  raw = createDictDb();
  db = wrap(raw);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  raw.close();
});

describe("getEntries", () => {
  test("returns the requested entries in order", async () => {
    const entries = await getEntries(db, [1000003, 1000001]);
    expect(entries.map((e) => e.id)).toEqual([1000003, 1000001]);
    expect(getDisplayText(entries[0])).toBe("電球");
    expect(getTargetReading(entries[0])).toBe("でんきゅう");
  });

  /**
   * The kanji sentinel: list_entries and srs_cards store kanji rows with
   * entry_id = 0 and the character in kanji_literal. Feeding one to a word
   * lookup used to assemble an entry with no kanji, kana or senses — a blank
   * word block in the games, a blank flashcard, and in the typing game a word
   * with no reading to type and so no way to advance.
   */
  test("skips the entry_id = 0 kanji sentinel instead of inventing a blank entry", async () => {
    const entries = await getEntries(db, [1000001, 0, 1000002]);
    expect(entries.map((e) => e.id)).toEqual([1000001, 1000002]);
  });

  test("skips ids the dictionary does not have", async () => {
    const entries = await getEntries(db, [1000001, 1234567]);
    expect(entries.map((e) => e.id)).toEqual([1000001]);
  });

  test("names the missing ids rather than failing silently", async () => {
    await getEntries(db, [1000001, 0, 1234567, 1234567]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("0, 1234567");
  });

  test("never returns an entry without a display form or a reading", async () => {
    const entries = await getEntries(db, [0, 1000001, 1234567, 1000002]);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(getDisplayText(entry)).not.toBe("");
      expect(getTargetReading(entry)).not.toBe("");
    }
  });

  test("returns nothing when no id exists", async () => {
    expect(await getEntries(db, [0, 0, 999])).toEqual([]);
  });

  test("does not warn when every id resolves", async () => {
    await getEntries(db, [1000001, 1000002]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getEntry", () => {
  test("returns null for an id the dictionary does not have", async () => {
    expect(await getEntry(db, 0)).toBeNull();
    expect(await getEntry(db, 1234567)).toBeNull();
  });

  test("returns the entry for an id it has", async () => {
    const entry = await getEntry(db, 1000002);
    expect(entry?.id).toBe(1000002);
    expect(getDisplayText(entry!)).toBe("半端");
  });
});
