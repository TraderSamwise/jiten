import { create } from "zustand";
import type { WrappedUserDb } from "@/db/user-db";

interface BookmarkState {
  /** Set of compound keys ("e:123" for entries, "k:食" for kanji) in any list */
  bookmarkedIds: Set<string>;
  /** Which lists each key belongs to, so the reader can highlight a subset. */
  listIdsByKey: Map<string, Set<string>>;
  /** Load all bookmarked entry/kanji IDs from the user database */
  load: (userDb: WrappedUserDb) => Promise<void>;
  /** Mark an item as bookmarked in one list (optimistic update) */
  add: (key: string, listId: string) => void;
  /**
   * Take an item out of one list (optimistic update).
   *
   * It stops being bookmarked only when no list still holds it, which is why
   * `listIdsByKey` has to be maintained here and not only by `load`: the
   * reader decides what to highlight from it, and a caller that has just
   * added something cannot wait for a reload to find out where it went.
   */
  remove: (key: string, listId: string) => void;
}

export const useBookmarkStore = create<BookmarkState>((set) => ({
  bookmarkedIds: new Set(),
  listIdsByKey: new Map(),
  load: async (userDb) => {
    const entryRows = await userDb.getAllAsync<{ entry_id: number; list_id: string }>(
      `SELECT DISTINCT le.entry_id, le.list_id FROM list_entries le
       JOIN lists l ON le.list_id = l.id
       WHERE le.kanji_literal IS NULL AND l.is_default = 0 AND le.deleted_at IS NULL AND l.deleted_at IS NULL`,
    );
    const kanjiRows = await userDb.getAllAsync<{ kanji_literal: string; list_id: string }>(
      `SELECT DISTINCT le.kanji_literal, le.list_id FROM list_entries le
       JOIN lists l ON le.list_id = l.id
       WHERE le.kanji_literal IS NOT NULL AND l.is_default = 0 AND le.deleted_at IS NULL AND l.deleted_at IS NULL`,
    );
    const ids = new Set<string>();
    const listIdsByKey = new Map<string, Set<string>>();
    const note = (key: string, listId: string) => {
      ids.add(key);
      const found = listIdsByKey.get(key);
      if (found) found.add(listId);
      else listIdsByKey.set(key, new Set([listId]));
    };
    for (const r of entryRows) note(`e:${r.entry_id}`, r.list_id);
    for (const r of kanjiRows) note(`k:${r.kanji_literal}`, r.list_id);
    set({ bookmarkedIds: ids, listIdsByKey });
  },
  add: (key, listId) =>
    set((state) => {
      const bookmarkedIds = new Set(state.bookmarkedIds);
      bookmarkedIds.add(key);
      const listIdsByKey = new Map(state.listIdsByKey);
      listIdsByKey.set(key, new Set(listIdsByKey.get(key) ?? []).add(listId));
      return { bookmarkedIds, listIdsByKey };
    }),
  remove: (key, listId) =>
    set((state) => {
      const listIdsByKey = new Map(state.listIdsByKey);
      const left = new Set(listIdsByKey.get(key) ?? []);
      left.delete(listId);
      if (left.size > 0) listIdsByKey.set(key, left);
      else listIdsByKey.delete(key);

      const bookmarkedIds = new Set(state.bookmarkedIds);
      if (left.size === 0) bookmarkedIds.delete(key);
      return { bookmarkedIds, listIdsByKey };
    }),
}));
