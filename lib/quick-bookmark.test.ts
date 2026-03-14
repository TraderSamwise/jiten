import { describe, test, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb } from "@/test/test-db";
import { getUserDrizzle } from "@/db/drizzle";
import type { UserDrizzle } from "@/db/drizzle";
import {
  addEntryToList,
  removeEntryFromList,
  getEntryListIds,
  addKanjiToList,
  removeKanjiFromList,
  getKanjiListIds,
} from "./quick-bookmark";
import { generateId } from "@/db/helpers";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { WrappedUserDb } from "@/db/user-db";

let rawDb: WrappedUserDb & { close: () => void };
let db: UserDrizzle;

beforeEach(() => {
  if (rawDb) rawDb.close();
  rawDb = createTestDb();
  db = getUserDrizzle(rawDb);
  // Reset bookmark store
  useBookmarkStore.setState({ bookmarkedIds: new Set() });
});

afterAll(() => {
  if (rawDb) rawDb.close();
});

// Helper: create a user list
async function createList(id: string, name: string, isDefault = false) {
  const now = new Date().toISOString();
  await rawDb.runAsync(
    "INSERT INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, name, isDefault ? 1 : 0, now, now],
  );
}

// Helper: add entry to a default list (bypassing quick-bookmark to simulate seed data)
async function seedDefaultListEntry(listId: string, entryId: number) {
  const now = new Date().toISOString();
  await rawDb.runAsync(
    "INSERT INTO list_entries (id, list_id, entry_id, added_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [generateId(), listId, entryId, now, now],
  );
}

// ─── Entry bookmarking ───

describe("addEntryToList", () => {
  test("adds entry and updates bookmark store", async () => {
    await createList("my-list", "My List");
    await addEntryToList(db, 1001, "my-list");

    const ids = await getEntryListIds(db, 1001);
    expect(ids).toEqual(["my-list"]);
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);
  });
});

describe("removeEntryFromList", () => {
  test("removes entry and clears bookmark store when no lists remain", async () => {
    await createList("my-list", "My List");
    await addEntryToList(db, 1001, "my-list");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);

    await removeEntryFromList(db, 1001, "my-list");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(false);
  });

  test("keeps bookmark when entry is still in another user list", async () => {
    await createList("list-a", "List A");
    await createList("list-b", "List B");
    await addEntryToList(db, 1001, "list-a");
    await addEntryToList(db, 1001, "list-b");

    await removeEntryFromList(db, 1001, "list-a");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);

    await removeEntryFromList(db, 1001, "list-b");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(false);
  });

  test("clears bookmark even when entry exists in a default list", async () => {
    await createList("default-jlpt-n5", "JLPT N5", true);
    await createList("my-list", "My List");
    await seedDefaultListEntry("default-jlpt-n5", 1001);
    await addEntryToList(db, 1001, "my-list");

    // Entry is in both default and user list — bookmarked
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);

    // Remove from user list — should unbookmark even though default list still has it
    await removeEntryFromList(db, 1001, "my-list");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(false);
  });
});

describe("getEntryListIds", () => {
  test("excludes default lists", async () => {
    await createList("default-jlpt-n5", "JLPT N5", true);
    await createList("my-list", "My List");
    await seedDefaultListEntry("default-jlpt-n5", 1001);
    await addEntryToList(db, 1001, "my-list");

    const ids = await getEntryListIds(db, 1001);
    expect(ids).toEqual(["my-list"]);
  });

  test("excludes soft-deleted entries", async () => {
    await createList("my-list", "My List");
    await addEntryToList(db, 1001, "my-list");
    await removeEntryFromList(db, 1001, "my-list");

    const ids = await getEntryListIds(db, 1001);
    expect(ids).toEqual([]);
  });
});

// ─── Kanji bookmarking ───

describe("addKanjiToList", () => {
  test("adds kanji and updates bookmark store", async () => {
    await createList("my-list", "My List");
    await addKanjiToList(db, "食", "my-list");

    const ids = await getKanjiListIds(db, "食");
    expect(ids).toEqual(["my-list"]);
    expect(useBookmarkStore.getState().bookmarkedIds.has("k:食")).toBe(true);
  });
});

describe("removeKanjiFromList", () => {
  test("clears bookmark even when kanji exists in a default list", async () => {
    await createList("default-kanji", "Default Kanji", true);
    await createList("my-list", "My List");

    // Seed into default list
    const now = new Date().toISOString();
    await rawDb.runAsync(
      "INSERT INTO list_entries (id, list_id, entry_id, kanji_literal, added_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)",
      [generateId(), "default-kanji", "食", now, now],
    );

    await addKanjiToList(db, "食", "my-list");
    expect(useBookmarkStore.getState().bookmarkedIds.has("k:食")).toBe(true);

    await removeKanjiFromList(db, "食", "my-list");
    expect(useBookmarkStore.getState().bookmarkedIds.has("k:食")).toBe(false);
  });
});
