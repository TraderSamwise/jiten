import { create } from "zustand";
import type { WrappedUserDb } from "@/db/user-db";

interface BookmarkState {
  /** Set of entry IDs that appear in any bookmark list */
  bookmarkedIds: Set<number>;
  /** Load all bookmarked entry IDs from the user database */
  load: (userDb: WrappedUserDb) => Promise<void>;
  /** Mark an entry as bookmarked (optimistic update) */
  add: (entryId: number) => void;
  /** Remove an entry from bookmarked set (optimistic update) */
  remove: (entryId: number) => void;
}

export const useBookmarkStore = create<BookmarkState>((set) => ({
  bookmarkedIds: new Set(),
  load: async (userDb) => {
    const rows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT DISTINCT entry_id FROM list_entries",
    );
    set({ bookmarkedIds: new Set(rows.map((r) => r.entry_id)) });
  },
  add: (entryId) =>
    set((state) => {
      const next = new Set(state.bookmarkedIds);
      next.add(entryId);
      return { bookmarkedIds: next };
    }),
  remove: (entryId) =>
    set((state) => {
      const next = new Set(state.bookmarkedIds);
      next.delete(entryId);
      return { bookmarkedIds: next };
    }),
}));
