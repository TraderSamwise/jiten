import type { WrappedUserDb } from "@/db/user-db";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";

/**
 * Load the in-memory stores that say what the user has saved.
 *
 * Both are read outside the Lists tab, so neither can wait for it. The reader
 * highlights bookmarked words and offers to leave a whole list out of that:
 * with the lists unloaded, the setting shows no lists to leave out and looks
 * like it does nothing. That is what happened — the chips were invisible
 * until the Lists tab had been opened once.
 */
export async function hydrateUserStores(userDb: WrappedUserDb): Promise<void> {
  await Promise.all([
    useBookmarkStore.getState().load(userDb),
    useListsStore.getState().load(userDb),
  ]);
}
