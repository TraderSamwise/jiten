import { and, eq, isNull, max } from "drizzle-orm";
import { createNewCard } from "@/stores/srs";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import { listEntries, lists, srsCards } from "@/db/schema";
import { generateId, notDeleted, withSoftDelete } from "@/db/helpers";
import type { UserDrizzle } from "@/db/drizzle";

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

/**
 * Show the bookmark before writing it.
 *
 * The button and the reader's highlight both read the stores, and the write
 * underneath is several statements — a MAX(position), two INSERTs, and on the
 * way out two UPDATEs. Waiting for them is what made saving a word feel slow.
 * So the stores move first and the returned undo puts them back if the write
 * does not land; nothing here swallows the error.
 */
function showBookmarkNow(key: string, listId: string, added: boolean): () => void {
  const lists = useListsStore.getState();
  const before = lists.lists.find((list) => list.id === listId)?.entryCount;

  const step = added ? 1 : -1;
  if (before !== undefined) {
    lists.updateList(listId, { entryCount: Math.max(0, before + step) });
  }
  if (added) useBookmarkStore.getState().add(key, listId);
  else useBookmarkStore.getState().remove(key, listId);

  return () => {
    // Relative, not back to what it was: another save may have landed in
    // between, and this one only ever moved the count by one.
    const now = useListsStore.getState().lists.find((list) => list.id === listId)?.entryCount;
    if (now !== undefined) {
      useListsStore.getState().updateList(listId, { entryCount: Math.max(0, now - step) });
    }
    if (added) useBookmarkStore.getState().remove(key, listId);
    else useBookmarkStore.getState().add(key, listId);
  };
}

/**
 * How many writes are in flight for each key.
 *
 * Reconciling against the database is only safe when nothing else is still
 * moving: tap-remove from one list and tap-add to another, and the first
 * write's reconcile would read the database before the second's insert
 * landed and delete a membership the user had just asked for.
 */
const writesInFlight = new Map<string, number>();

function beginWrite(key: string): void {
  writesInFlight.set(key, (writesInFlight.get(key) ?? 0) + 1);
}

function endWrite(key: string): void {
  const left = (writesInFlight.get(key) ?? 1) - 1;
  if (left > 0) writesInFlight.set(key, left);
  else writesInFlight.delete(key);
}

/** Next append position for a list (MAX(position) + 1, or 0 for an empty list). */
async function nextListPosition(db: UserDrizzle, listId: string): Promise<number> {
  const [row] = await db
    .select({ maxPos: max(listEntries.position) })
    .from(listEntries)
    .where(eq(listEntries.listId, listId));
  return (row?.maxPos ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Word entry DB operations
// ---------------------------------------------------------------------------

export async function addEntryToList(db: UserDrizzle, entryId: number, listId: string) {
  const now = new Date().toISOString();
  const key = `e:${entryId}`;
  const undo = showBookmarkNow(key, listId, true);
  beginWrite(key);
  try {
    await writeEntryToList(db, entryId, listId, now);
  } catch (err) {
    undo();
    throw err;
  } finally {
    endWrite(key);
  }
  reconcileBookmark(key, await getEntryListIds(db, entryId));
}

async function writeEntryToList(
  db: UserDrizzle,
  entryId: number,
  listId: string,
  now: string,
): Promise<void> {
  await db
    .insert(listEntries)
    .values({
      id: generateId(),
      listId,
      entryId,
      addedAt: now,
      position: await nextListPosition(db, listId),
      updatedAt: now,
    })
    .onConflictDoNothing();

  const card = createNewCard();
  await db
    .insert(srsCards)
    .values({
      id: generateId(),
      entryId,
      listId,
      due: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.last_review?.toISOString() ?? null,
      frontMode: "kanji",
      backMode: "english",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function removeEntryFromList(db: UserDrizzle, entryId: number, listId: string) {
  const key = `e:${entryId}`;
  const undo = showBookmarkNow(key, listId, false);
  beginWrite(key);
  try {
    await unwriteEntryFromList(db, entryId, listId);
  } catch (err) {
    undo();
    throw err;
  } finally {
    endWrite(key);
  }
  reconcileBookmark(key, await getEntryListIds(db, entryId));
}

async function unwriteEntryFromList(db: UserDrizzle, entryId: number, listId: string) {
  await db
    .update(listEntries)
    .set(withSoftDelete())
    .where(
      and(
        eq(listEntries.listId, listId),
        eq(listEntries.entryId, entryId),
        isNull(listEntries.kanjiLiteral),
      ),
    );
  await db
    .update(srsCards)
    .set(withSoftDelete())
    .where(
      and(
        eq(srsCards.entryId, entryId),
        eq(srsCards.listId, listId),
        isNull(srsCards.kanjiLiteral),
      ),
    );
}

/**
 * Put the store's idea of which lists hold a key back onto the database's.
 *
 * Skipped while another write for the same key is still in flight, because
 * the database cannot yet be telling the truth about it.
 */
function reconcileBookmark(key: string, listIds: readonly string[]): void {
  if (writesInFlight.has(key)) return;
  const held = useBookmarkStore.getState().listIdsByKey.get(key) ?? new Set<string>();
  for (const listId of listIds) if (!held.has(listId)) useBookmarkStore.getState().add(key, listId);
  for (const listId of held) {
    if (!listIds.includes(listId)) useBookmarkStore.getState().remove(key, listId);
  }
}

export async function getEntryListIds(db: UserDrizzle, entryId: number): Promise<string[]> {
  const rows = await db
    .select({ listId: listEntries.listId })
    .from(listEntries)
    .innerJoin(lists, eq(listEntries.listId, lists.id))
    .where(
      and(
        eq(listEntries.entryId, entryId),
        isNull(listEntries.kanjiLiteral),
        eq(lists.isDefault, 0),
        notDeleted(listEntries.deletedAt),
        notDeleted(lists.deletedAt),
      ),
    );
  return rows.map((r) => r.listId);
}

// ---------------------------------------------------------------------------
// Kanji character DB operations
// ---------------------------------------------------------------------------

export async function addKanjiToList(db: UserDrizzle, kanjiLiteral: string, listId: string) {
  const now = new Date().toISOString();
  const key = `k:${kanjiLiteral}`;
  const undo = showBookmarkNow(key, listId, true);
  beginWrite(key);
  try {
    await writeKanjiToList(db, kanjiLiteral, listId, now);
  } catch (err) {
    undo();
    throw err;
  } finally {
    endWrite(key);
  }
  reconcileBookmark(key, await getKanjiListIds(db, kanjiLiteral));
}

async function writeKanjiToList(
  db: UserDrizzle,
  kanjiLiteral: string,
  listId: string,
  now: string,
): Promise<void> {
  await db
    .insert(listEntries)
    .values({
      id: generateId(),
      listId,
      entryId: 0,
      kanjiLiteral,
      addedAt: now,
      position: await nextListPosition(db, listId),
      updatedAt: now,
    })
    .onConflictDoNothing();

  const card = createNewCard();
  await db
    .insert(srsCards)
    .values({
      id: generateId(),
      entryId: 0,
      kanjiLiteral,
      listId,
      due: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.last_review?.toISOString() ?? null,
      frontMode: "kanji",
      backMode: "english",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function removeKanjiFromList(db: UserDrizzle, kanjiLiteral: string, listId: string) {
  const key = `k:${kanjiLiteral}`;
  const undo = showBookmarkNow(key, listId, false);
  beginWrite(key);
  try {
    await unwriteKanjiFromList(db, kanjiLiteral, listId);
  } catch (err) {
    undo();
    throw err;
  } finally {
    endWrite(key);
  }
  reconcileBookmark(key, await getKanjiListIds(db, kanjiLiteral));
}

async function unwriteKanjiFromList(db: UserDrizzle, kanjiLiteral: string, listId: string) {
  await db
    .update(listEntries)
    .set(withSoftDelete())
    .where(and(eq(listEntries.listId, listId), eq(listEntries.kanjiLiteral, kanjiLiteral)));
  await db
    .update(srsCards)
    .set(withSoftDelete())
    .where(and(eq(srsCards.kanjiLiteral, kanjiLiteral), eq(srsCards.listId, listId)));
}

export async function getKanjiListIds(db: UserDrizzle, kanjiLiteral: string): Promise<string[]> {
  const rows = await db
    .select({ listId: listEntries.listId })
    .from(listEntries)
    .innerJoin(lists, eq(listEntries.listId, lists.id))
    .where(
      and(
        eq(listEntries.kanjiLiteral, kanjiLiteral),
        eq(lists.isDefault, 0),
        notDeleted(listEntries.deletedAt),
        notDeleted(lists.deletedAt),
      ),
    );
  return rows.map((r) => r.listId);
}
