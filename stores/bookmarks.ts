import { create } from "zustand";
import type { WrappedUserDb } from "@/db/user-db";

interface BookmarkState {
  /** Set of compound keys ("e:123" for entries, "k:食" for kanji) in any list */
  bookmarkedIds: Set<string>;
  /** Load all bookmarked entry/kanji IDs from the user database */
  load: (userDb: WrappedUserDb) => Promise<void>;
  /** Mark an item as bookmarked (optimistic update) */
  add: (key: string) => void;
  /** Remove an item from bookmarked set (optimistic update) */
  remove: (key: string) => void;
}

export const useBookmarkStore = create<BookmarkState>((set) => ({
  bookmarkedIds: new Set(),
  load: async (userDb) => {
    const entryRows = await userDb.getAllAsync<{ entry_id: number }>(
      `SELECT DISTINCT le.entry_id FROM list_entries le
       JOIN lists l ON le.list_id = l.id
       WHERE le.kanji_literal IS NULL AND l.is_default = 0 AND le.deleted_at IS NULL AND l.deleted_at IS NULL`,
    );
    const kanjiRows = await userDb.getAllAsync<{ kanji_literal: string }>(
      `SELECT DISTINCT le.kanji_literal FROM list_entries le
       JOIN lists l ON le.list_id = l.id
       WHERE le.kanji_literal IS NOT NULL AND l.is_default = 0 AND le.deleted_at IS NULL AND l.deleted_at IS NULL`,
    );
    const ids = new Set<string>();
    for (const r of entryRows) ids.add(`e:${r.entry_id}`);
    for (const r of kanjiRows) ids.add(`k:${r.kanji_literal}`);
    set({ bookmarkedIds: ids });
  },
  add: (key) =>
    set((state) => {
      const next = new Set(state.bookmarkedIds);
      next.add(key);
      return { bookmarkedIds: next };
    }),
  remove: (key) =>
    set((state) => {
      const next = new Set(state.bookmarkedIds);
      next.delete(key);
      return { bookmarkedIds: next };
    }),
}));
