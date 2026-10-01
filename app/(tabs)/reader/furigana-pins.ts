import type { ReaderFuriganaPins } from "@tradersamwise/jiten-reader-react-native";

import type { WrappedUserDb } from "@/db/user-db";
import { clearAllPins, clearPin, listPins, setPin } from "@/lib/furigana-pins";

/**
 * The reader's pinned-reading port, backed by the user DB.
 *
 * Failures are deliberately NOT caught here. The reader repaints the page as
 * soon as a write returns, so swallowing one would show a pin that was never
 * stored — right until the next reload. A SQLite fault already reaches the
 * recovery UI through `wrapUserDb`, and the caller logs the rest.
 */
export function createJitenFuriganaPins(
  userDb: WrappedUserDb,
  markDirty: () => void,
): ReaderFuriganaPins {
  return {
    list: (bookId) => listPins(userDb, bookId),
    async set(bookId, surface, reading) {
      await setPin(userDb, bookId, surface, reading);
      markDirty();
    },
    async clear(bookId, surface) {
      await clearPin(userDb, bookId, surface);
      markDirty();
    },
    async clearAll(bookId) {
      await clearAllPins(userDb, bookId);
      markDirty();
    },
  };
}
