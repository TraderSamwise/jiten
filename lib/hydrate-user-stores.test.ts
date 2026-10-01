/**
 * The reader's list-exclusion chips were invisible until the Lists tab had
 * been opened, because the lists store was the only thing that loaded them.
 * This pins both stores loading together, from one call, on a cold start.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/test-db";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import { hydrateUserStores } from "./hydrate-user-stores";

type TestDb = ReturnType<typeof createTestDb>;

describe("hydrateUserStores", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    useBookmarkStore.setState({ bookmarkedIds: new Set(), listIdsByKey: new Map() });
    useListsStore.setState({ lists: [], listsLoaded: false });

    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO lists (id, name, created_at, updated_at, is_default) VALUES (?, ?, ?, ?, 0)`,
      ["common", "Common", now, now],
    );
    await db.runAsync(
      `INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, ?, ?)`,
      ["e1", "common", 1557390, now],
    );
  });

  afterEach(() => db.close());

  it("loads the saved words and the lists they belong to", async () => {
    await hydrateUserStores(db);

    expect([...useBookmarkStore.getState().bookmarkedIds]).toContain("e:1557390");
    // The reader needs this one to offer a list to leave out of highlighting.
    expect(useListsStore.getState().lists.map((list) => list.id)).toContain("common");
  });

  /**
   * The chip the reader offers is filtered twice over — the store drops the
   * ephemeral `_smart_` / `_marked_` lists, and the reader drops the default
   * one. Both filters have to hold or the setting shows a list that cannot be
   * excluded, or hides one that can.
   */
  it("leaves out the lists the reader must not offer", async () => {
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO lists (id, name, created_at, updated_at, is_default) VALUES (?, ?, ?, ?, 1)`,
      ["default", "Saved", now, now],
    );
    await db.runAsync(
      `INSERT INTO lists (id, name, created_at, updated_at, is_default) VALUES (?, ?, ?, ?, 0)`,
      ["_marked_1", "Marked for review", now, now],
    );

    await hydrateUserStores(db);

    const ids = useListsStore.getState().lists.map((list) => list.id);
    expect(ids).not.toContain("_marked_1");
    // The default list IS in the store; the reader is what filters it out.
    expect(ids).toContain("default");
    expect(ids.filter((id) => !id.startsWith("_") && id !== "default")).toEqual(["common"]);
  });
});
