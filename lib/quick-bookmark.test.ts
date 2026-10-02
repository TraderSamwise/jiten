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
  useBookmarkStore.setState({ bookmarkedIds: new Set(), listIdsByKey: new Map() });
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

// ─── Showing the bookmark before the write lands ───

/**
 * Saving a word used to wait on a MAX(position), two INSERTs and, on the way
 * out, two UPDATEs and a SELECT before the button could change. These pin the
 * order: the store moves first, and goes back if the write throws.
 */
describe("the store moves before the database does", () => {
  test("an entry is bookmarked before its insert finishes", async () => {
    await createList("my-list", "My List");
    let bookmarkedDuringWrite = false;
    const watched = new Proxy(db, {
      get(target, prop, receiver) {
        bookmarkedDuringWrite ||= useBookmarkStore.getState().bookmarkedIds.has("e:1001");
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as UserDrizzle;

    await addEntryToList(watched, 1001, "my-list");
    expect(bookmarkedDuringWrite).toBe(true);
  });

  test("a failed insert puts the store back", async () => {
    await createList("my-list", "My List");
    const broken = {
      insert: () => {
        throw new Error("no room on disk");
      },
      select: db.select.bind(db),
    } as unknown as UserDrizzle;

    await expect(addEntryToList(broken, 1001, "my-list")).rejects.toThrow("no room on disk");
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(false);
  });

  test("a failed removal puts the store back", async () => {
    await createList("my-list", "My List");
    await addEntryToList(db, 1001, "my-list");
    const broken = {
      update: () => {
        throw new Error("database is locked");
      },
    } as unknown as UserDrizzle;

    await expect(removeEntryFromList(broken, 1001, "my-list")).rejects.toThrow(
      "database is locked",
    );
    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);
  });
});

describe("which lists hold a key", () => {
  test("an entry in two lists stays bookmarked after leaving one", async () => {
    await createList("one", "One");
    await createList("two", "Two");
    await addEntryToList(db, 1001, "one");
    await addEntryToList(db, 1001, "two");

    await removeEntryFromList(db, 1001, "one");

    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);
    expect([...(useBookmarkStore.getState().listIdsByKey.get("e:1001") ?? [])]).toEqual(["two"]);
  });

  test("it stops being bookmarked when the last list lets it go", async () => {
    await createList("one", "One");
    await addEntryToList(db, 1001, "one");

    await removeEntryFromList(db, 1001, "one");

    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(false);
    expect(useBookmarkStore.getState().listIdsByKey.has("e:1001")).toBe(false);
  });
});

/**
 * Two toggles of the same word in flight at once: the first to finish must
 * not reconcile against a database that has not yet heard about the second.
 */
describe("two saves of the same word at once", () => {
  test("the later one survives the earlier one's reconcile", async () => {
    await createList("one", "One");
    await createList("two", "Two");
    await addEntryToList(db, 1001, "one");

    // An insert that does not land until we say so.
    let release!: () => void;
    const landed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "insert") return Reflect.get(target, prop, receiver) as unknown;
        return (...args: unknown[]) => {
          const builder = (target.insert as (...a: unknown[]) => unknown)(...args) as {
            values: (...a: unknown[]) => { onConflictDoNothing: () => Promise<unknown> };
          };
          return {
            values: (...rows: unknown[]) => ({
              onConflictDoNothing: async () => {
                await landed;
                return builder.values(...rows).onConflictDoNothing();
              },
            }),
          };
        };
      },
    }) as UserDrizzle;

    // What the button would show, every time the store moves.
    const shown: boolean[] = [];
    const unsubscribe = useBookmarkStore.subscribe((state) =>
      shown.push(state.bookmarkedIds.has("e:1001")),
    );

    const adding = addEntryToList(held, 1001, "two");
    await removeEntryFromList(db, 1001, "one");
    release();
    await adding;
    unsubscribe();

    expect(useBookmarkStore.getState().bookmarkedIds.has("e:1001")).toBe(true);
    expect([...(useBookmarkStore.getState().listIdsByKey.get("e:1001") ?? [])]).toEqual(["two"]);
    // And it never blinked off on the way: the word was saved throughout.
    expect(shown).not.toContain(false);
  });
});
