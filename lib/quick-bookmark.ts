import { createNewCard } from "@/stores/srs";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import type { WrappedUserDb } from "@/db/user-db";

// ---------------------------------------------------------------------------
// Session state (resets on app restart, shared across components)
// ---------------------------------------------------------------------------

export let lastUsedListId: string | null = null;
export let lastQuickActionEntryId: number | null = null;
export let lastQuickActionKanjiLiteral: string | null = null;

export function setLastUsedListId(id: string | null) {
  lastUsedListId = id;
}

export function setLastQuickActionEntryId(entryId: number | null) {
  lastQuickActionEntryId = entryId;
}

export function setLastQuickActionKanjiLiteral(literal: string | null) {
  lastQuickActionKanjiLiteral = literal;
}

// ---------------------------------------------------------------------------
// Shared ID generator
// ---------------------------------------------------------------------------

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ---------------------------------------------------------------------------
// Word entry DB operations
// ---------------------------------------------------------------------------

export async function addEntryToList(userDb: WrappedUserDb, entryId: number, listId: string) {
  const now = new Date().toISOString();

  await userDb.runAsync(
    "INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, ?, ?)",
    [generateId(), listId, entryId, now],
  );

  const card = createNewCard();
  await userDb.runAsync(
    `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty,
      elapsed_days, scheduled_days, reps, lapses, state, last_review,
      front_mode, back_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      entryId,
      listId,
      card.due.toISOString(),
      card.stability,
      card.difficulty,
      card.elapsed_days,
      card.scheduled_days,
      card.reps,
      card.lapses,
      card.state,
      card.last_review?.toISOString() ?? null,
      "kanji",
      "english",
      now,
      now,
    ],
  );

  // Update stores
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur) useListsStore.getState().updateList(listId, { entryCount: (cur.entryCount ?? 0) + 1 });
  useBookmarkStore.getState().add(`e:${entryId}`);
}

export async function removeEntryFromList(userDb: WrappedUserDb, entryId: number, listId: string) {
  await userDb.runAsync(
    "DELETE FROM list_entries WHERE list_id = ? AND entry_id = ? AND kanji_literal IS NULL",
    [listId, entryId],
  );
  await userDb.runAsync(
    "DELETE FROM srs_cards WHERE entry_id = ? AND list_id = ? AND kanji_literal IS NULL",
    [entryId, listId],
  );

  // Update list entry count
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur)
    useListsStore
      .getState()
      .updateList(listId, { entryCount: Math.max(0, (cur.entryCount ?? 1) - 1) });

  // Only remove from bookmark store if entry is no longer in any list
  const remaining = await getEntryListIds(userDb, entryId);
  if (remaining.length === 0) {
    useBookmarkStore.getState().remove(`e:${entryId}`);
  }
}

export async function getEntryListIds(userDb: WrappedUserDb, entryId: number): Promise<string[]> {
  const rows = await userDb.getAllAsync<{ list_id: string }>(
    "SELECT list_id FROM list_entries WHERE entry_id = ? AND kanji_literal IS NULL",
    [entryId],
  );
  return rows.map((r) => r.list_id);
}

// ---------------------------------------------------------------------------
// Kanji character DB operations
// ---------------------------------------------------------------------------

export async function addKanjiToList(userDb: WrappedUserDb, kanjiLiteral: string, listId: string) {
  const now = new Date().toISOString();

  await userDb.runAsync(
    "INSERT INTO list_entries (id, list_id, entry_id, kanji_literal, added_at) VALUES (?, ?, 0, ?, ?)",
    [generateId(), listId, kanjiLiteral, now],
  );

  const card = createNewCard();
  await userDb.runAsync(
    `INSERT INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty,
      elapsed_days, scheduled_days, reps, lapses, state, last_review,
      front_mode, back_mode, created_at, updated_at)
     VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      kanjiLiteral,
      listId,
      card.due.toISOString(),
      card.stability,
      card.difficulty,
      card.elapsed_days,
      card.scheduled_days,
      card.reps,
      card.lapses,
      card.state,
      card.last_review?.toISOString() ?? null,
      "kanji",
      "english",
      now,
      now,
    ],
  );

  // Update stores
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur) useListsStore.getState().updateList(listId, { entryCount: (cur.entryCount ?? 0) + 1 });
  useBookmarkStore.getState().add(`k:${kanjiLiteral}`);
}

export async function removeKanjiFromList(
  userDb: WrappedUserDb,
  kanjiLiteral: string,
  listId: string,
) {
  await userDb.runAsync("DELETE FROM list_entries WHERE list_id = ? AND kanji_literal = ?", [
    listId,
    kanjiLiteral,
  ]);
  await userDb.runAsync("DELETE FROM srs_cards WHERE kanji_literal = ? AND list_id = ?", [
    kanjiLiteral,
    listId,
  ]);

  // Update list entry count
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur)
    useListsStore
      .getState()
      .updateList(listId, { entryCount: Math.max(0, (cur.entryCount ?? 1) - 1) });

  // Only remove from bookmark store if kanji is no longer in any list
  const remaining = await getKanjiListIds(userDb, kanjiLiteral);
  if (remaining.length === 0) {
    useBookmarkStore.getState().remove(`k:${kanjiLiteral}`);
  }
}

export async function getKanjiListIds(
  userDb: WrappedUserDb,
  kanjiLiteral: string,
): Promise<string[]> {
  const rows = await userDb.getAllAsync<{ list_id: string }>(
    "SELECT list_id FROM list_entries WHERE kanji_literal = ?",
    [kanjiLiteral],
  );
  return rows.map((r) => r.list_id);
}
