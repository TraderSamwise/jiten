import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@/test/test-db";
import {
  seedDefaultBookIfNeeded,
  makeDefaultListId,
  seedDefaultListsIfNeeded,
} from "./seed-default-lists";
import type { WrappedUserDb } from "@/db/user-db";
import type * as SQLite from "expo-sqlite";

let db: WrappedUserDb & { close: () => void };

beforeEach(() => {
  if (db) db.close();
  db = createTestDb();
});

afterAll(() => {
  if (db) db.close();
});

// ─── makeDefaultListId ───

describe("makeDefaultListId", () => {
  test("produces deterministic kebab-case IDs", () => {
    expect(makeDefaultListId("JLPT N5 Kanji")).toBe("default-jlpt-n5-kanji");
    expect(makeDefaultListId("Jouyou Grade 1")).toBe("default-jouyou-grade-1");
  });

  test("is stable across calls", () => {
    const a = makeDefaultListId("JLPT N5 Kanji");
    const b = makeDefaultListId("JLPT N5 Kanji");
    expect(a).toBe(b);
  });
});

// ─── seedDefaultBookIfNeeded ───

describe("seedDefaultBookIfNeeded", () => {
  test("inserts the default book on first call", async () => {
    await seedDefaultBookIfNeeded(db);

    const book = await db.getFirstAsync<{ title: string; is_default: number }>(
      "SELECT title, is_default FROM books WHERE id = ?",
      [makeDefaultListId("yume-juuya")],
    );
    expect(book).toBeTruthy();
    expect(book!.title).toBe("夢十夜");
    expect(book!.is_default).toBe(1);
  });

  test("sets the app flag after seeding", async () => {
    await seedDefaultBookIfNeeded(db);

    const flag = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_flags WHERE key = 'default_book_seeded'",
    );
    expect(flag).toBeTruthy();
    expect(flag!.value).toBe("1");
  });

  test("is idempotent — second call does nothing", async () => {
    await seedDefaultBookIfNeeded(db);
    await seedDefaultBookIfNeeded(db);

    const books = await db.getAllAsync("SELECT id FROM books WHERE id = ?", [
      makeDefaultListId("yume-juuya"),
    ]);
    expect(books).toHaveLength(1);
  });

  test("skips if flag already set", async () => {
    // Set flag before calling
    await db.runAsync("INSERT INTO app_flags (key, value) VALUES ('default_book_seeded', '1')");

    await seedDefaultBookIfNeeded(db);

    const books = await db.getAllAsync("SELECT id FROM books");
    expect(books).toHaveLength(0);
  });
});

// ─── seedDefaultListsIfNeeded ───

describe("seedDefaultListsIfNeeded", () => {
  // Create a minimal mock dictDb that returns empty results
  // so we can test the flag/idempotency logic without real dict data
  function createMockDictDb(): SQLite.SQLiteDatabase {
    return {
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
    } as unknown as SQLite.SQLiteDatabase;
  }

  test("sets kanji flag after seeding", async () => {
    const dictDb = createMockDictDb();
    await seedDefaultListsIfNeeded(db, dictDb);

    const flag = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_flags WHERE key = 'default_lists_seeded_v3'",
    );
    expect(flag).toBeTruthy();
  });

  test("sets vocab flag after seeding", async () => {
    const dictDb = createMockDictDb();
    await seedDefaultListsIfNeeded(db, dictDb);

    const flag = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_flags WHERE key = 'default_vocab_lists_seeded_v2'",
    );
    expect(flag).toBeTruthy();
  });

  test("is idempotent — second call returns false", async () => {
    const dictDb = createMockDictDb();
    const first = await seedDefaultListsIfNeeded(db, dictDb);
    expect(first).toBe(true);

    const second = await seedDefaultListsIfNeeded(db, dictDb);
    expect(second).toBe(false);
  });

  test("skips if flags already set", async () => {
    await db.runAsync("INSERT INTO app_flags (key, value) VALUES ('default_lists_seeded_v3', '1')");
    await db.runAsync(
      "INSERT INTO app_flags (key, value) VALUES ('default_vocab_lists_seeded_v2', '1')",
    );
    await db.runAsync("INSERT INTO app_flags (key, value) VALUES ('rtk_lessons_seeded', '1')");

    const dictDb = createMockDictDb();
    const result = await seedDefaultListsIfNeeded(db, dictDb);
    expect(result).toBe(false);

    // No lists should have been created
    const lists = await db.getAllAsync("SELECT id FROM lists");
    expect(lists).toHaveLength(0);
  });

  test("cleans up old default lists before re-seeding", async () => {
    // Simulate old default list that needs cleanup
    const now = new Date().toISOString();
    const oldListId = makeDefaultListId("JLPT N5 Kanji");
    await db.runAsync(
      "INSERT INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
      [oldListId, "JLPT N5 Kanji", now, now],
    );
    await db.runAsync(
      "INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, 0, ?)",
      ["entry-1", oldListId, now],
    );

    const dictDb = createMockDictDb();
    await seedDefaultListsIfNeeded(db, dictDb);

    // Old entries should be cleaned up
    const entries = await db.getAllAsync("SELECT id FROM list_entries WHERE list_id = ?", [
      oldListId,
    ]);
    expect(entries).toHaveLength(0);
  });
});
