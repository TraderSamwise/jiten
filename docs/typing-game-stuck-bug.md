# Typing Game Stuck Bug

## Symptom

After completing a word mid-batch, the game gets stuck: the user can type (text appears in the input), but nothing matches and the word never advances. Backspace to the previous word works, but re-completing it just gets stuck again on the same word. The next visible word is right there but unreachable.

Rare (seen once every few hundred words). Possibly word-specific.

## What we know

- The user CAN type and see text in the input, so `handleInput` is running and `setTypedRomaji` is being called (the guard `currentWordIndex >= words.length` is NOT triggering).
- The completion check (`isReadingComplete`) is failing, meaning the typed kana doesn't match the current entry's readings.
- The user types the reading of the next **visible** gray word, but the game's `currentWordIndex` appears to point at a **different** word.
- This is NOT at a batch boundary (page end). It happens mid-screen with many words still visible.

## Confirmed cause: entries with no kana (fixed)

`getEntries()` assembled one `DictEntry` per requested id whether or not the
`entries` table had a row for it, so any id the dictionary did not have came
back as an entry with no kanji, kana or senses. Two kinds of id reach it from
user data:

- **`entry_id = 0`**, the kanji sentinel. `list_entries` and `srs_cards` store a
  kanji row as `entry_id = 0` with the character in `kanji_literal`, so a list
  holding kanji fed `0` into the word games' dictionary lookup.
- **An id a later dictionary build dropped.** `importListToDb` inserts
  `entry.entryId` from an export file without checking the dictionary has it.

Such an entry renders as a zero-width blank word block, and `getTargetReading()`
returns `""` — so `isReadingComplete` can never match and the kana-count
auto-advance is blocked by its own `targetLen > 0` guard. The word is
permanently stuck, exactly as described above. It is also the blank flashcard
seen in `study.tsx`.

Fixed in three places:

- `getEntries()` returns only ids with a real `entries` row and warns, naming
  the missing ids. Every caller already guarded with `if (entry)` or
  `.filter(e => e !== undefined)`, so that dead code now does its job.
- `useWordFilter` excludes kanji entries (`kanji_literal IS NULL AND entry_id != 0`),
  which also stops the game-select word counts over-promising.
- `typing-game.tsx` skips a batch that resolves to nothing rather than sitting
  on an empty word list, and `connect-game.tsx` re-checks its 3-word minimum
  against what actually resolved.

Covered by `db/search.test.ts` and `hooks/useWordFilter.test.tsx`.

## Still unverified: index skip (double-advance from stale TextInput events)

When a word completes, `advanceWord` queues `setCurrentWordIndex(N+1)` and `setTypedRomaji("")`. On React Native, the controlled TextInput's native value may not clear immediately. If `onChangeText` fires with the old text after React commits the new state, `handleInput` runs against word N+1 with leftover kana from word N. If the kana count auto-advance triggers (`kanaCount >= targetLen`), word N+1 gets wrongly completed and the index jumps to N+2.

The user would see word N+1 turn green (thinking they completed it) and try to type word N+2. But `currentWordIndex` is actually at N+2 or beyond, pointing at a different word.

This mechanism has not been observed; the empty-entry cause above accounts for the reports so far.

## Diagnostic logging

A `console.warn` at the end of `handleInput` (dev only) fires when `converted.length >= 3` but no match or advance happened. It logs:

- `typed`: the converted kana string
- `target`: `getTargetReading(currentEntry)` — what the game thinks the current word's reading is
- `display`: `getDisplayText(currentEntry)` — the kanji/display text of the current word
- `index`: `currentWordIndex`
- `wordsLen`: `words.length`
- `completed`: whether the current word is already marked completed

**If the bug recurs**: check the console output. An empty `target`/`display` means
another empty-entry path slipped through — the `[dict] getEntries` warning will
name the id. A `target`/`display` that does not match the word the user was
typing means the index is out of sync, i.e. the unverified theory above.

## Potential fixes (not yet applied)

- **Ref guard**: Track the last completed word index in a ref (`lastCompletedRef`). In `handleInput`, bail out if `currentWordIndex <= lastCompletedRef.current`. Prevents re-processing a completed word from stale events.
- **Better current-word indicator**: Make the current word more visually distinct (e.g., underline or background highlight) so index desync is immediately obvious.
- **Validate ids on import**: `importListToDb` accepts any `entryId` from the
  export file. Checking them against the dictionary would stop stale ids
  entering a list at all, rather than being skipped at read time.
