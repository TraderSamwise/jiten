import { and, eq, isNull } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Word entry DB operations
// ---------------------------------------------------------------------------

export async function addEntryToList(db: UserDrizzle, entryId: number, listId: string) {
  const now = new Date().toISOString();

  await db
    .insert(listEntries)
    .values({
      id: generateId(),
      listId,
      entryId,
      addedAt: now,
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

  // Update stores
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur) useListsStore.getState().updateList(listId, { entryCount: (cur.entryCount ?? 0) + 1 });
  useBookmarkStore.getState().add(`e:${entryId}`);
}

export async function removeEntryFromList(db: UserDrizzle, entryId: number, listId: string) {
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

  // Update list entry count
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur)
    useListsStore
      .getState()
      .updateList(listId, { entryCount: Math.max(0, (cur.entryCount ?? 1) - 1) });

  // Only remove from bookmark store if entry is no longer in any list
  const remaining = await getEntryListIds(db, entryId);
  if (remaining.length === 0) {
    useBookmarkStore.getState().remove(`e:${entryId}`);
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

  await db
    .insert(listEntries)
    .values({
      id: generateId(),
      listId,
      entryId: 0,
      kanjiLiteral,
      addedAt: now,
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

  // Update stores
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur) useListsStore.getState().updateList(listId, { entryCount: (cur.entryCount ?? 0) + 1 });
  useBookmarkStore.getState().add(`k:${kanjiLiteral}`);
}

export async function removeKanjiFromList(db: UserDrizzle, kanjiLiteral: string, listId: string) {
  await db
    .update(listEntries)
    .set(withSoftDelete())
    .where(and(eq(listEntries.listId, listId), eq(listEntries.kanjiLiteral, kanjiLiteral)));
  await db
    .update(srsCards)
    .set(withSoftDelete())
    .where(and(eq(srsCards.kanjiLiteral, kanjiLiteral), eq(srsCards.listId, listId)));

  // Update list entry count
  const cur = useListsStore.getState().lists.find((l) => l.id === listId);
  if (cur)
    useListsStore
      .getState()
      .updateList(listId, { entryCount: Math.max(0, (cur.entryCount ?? 1) - 1) });

  // Only remove from bookmark store if kanji is no longer in any list
  const remaining = await getKanjiListIds(db, kanjiLiteral);
  if (remaining.length === 0) {
    useBookmarkStore.getState().remove(`k:${kanjiLiteral}`);
  }
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
