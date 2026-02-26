# Typing Game Stuck Bug

## Symptom

After completing a word mid-batch, the game gets stuck: the user can type (text appears in the input), but nothing matches and the word never advances. Backspace to the previous word works, but re-completing it just gets stuck again on the same word. The next visible word is right there but unreachable.

Rare (seen once every few hundred words). Possibly word-specific.

## What we know

- The user CAN type and see text in the input, so `handleInput` is running and `setTypedRomaji` is being called (the guard `currentWordIndex >= words.length` is NOT triggering).
- The completion check (`isReadingComplete`) is failing, meaning the typed kana doesn't match the current entry's readings.
- The user types the reading of the next **visible** gray word, but the game's `currentWordIndex` appears to point at a **different** word.
- This is NOT at a batch boundary (page end). It happens mid-screen with many words still visible.

## Theories

### 1. Index skip (double-advance from stale TextInput events)

When a word completes, `advanceWord` queues `setCurrentWordIndex(N+1)` and `setTypedRomaji("")`. On React Native, the controlled TextInput's native value may not clear immediately. If `onChangeText` fires with the old text after React commits the new state, `handleInput` runs against word N+1 with leftover kana from word N. If the kana count auto-advance triggers (`kanaCount >= targetLen`), word N+1 gets wrongly completed and the index jumps to N+2.

The user would see word N+1 turn green (thinking they completed it) and try to type word N+2. But `currentWordIndex` is actually at N+2 or beyond, pointing at a different word.

### 2. Entries with empty kana

If an entry has `kana: []`, `getTargetReading()` returns `""`, `isReadingComplete` never matches, and the auto-advance guard (`targetLen > 0`) blocks. The word is permanently stuck. This could happen if the dictionary DB has entries without kana rows.

### 3. Something else entirely

The exact root cause is unconfirmed. Could be a React Native controlled input desync, a stale closure edge case, or something we haven't considered.

## Diagnostic logging

Added a `console.warn` at the end of `handleInput` (dev only) that fires when `converted.length >= 3` but no match or advance happened. It logs:

- `typed`: the converted kana string
- `target`: `getTargetReading(currentEntry)` — what the game thinks the current word's reading is
- `display`: `getDisplayText(currentEntry)` — the kanji/display text of the current word
- `index`: `currentWordIndex`
- `wordsLen`: `words.length`
- `completed`: whether the current word is already marked completed

**When the bug recurs**: check the console output. The key signal is whether `target`/`display` match the word the user was trying to type. If they don't, the index is out of sync.

## Potential fixes (not yet applied)

- **Ref guard**: Track the last completed word index in a ref (`lastCompletedRef`). In `handleInput`, bail out if `currentWordIndex <= lastCompletedRef.current`. Prevents re-processing a completed word from stale events.
- **Filter empty kana**: In `loadBatch`, filter out entries where `entry.kana.length === 0`.
- **Better current-word indicator**: Make the current word more visually distinct (e.g., underline or background highlight) so index desync is immediately obvious.
