import { and, eq, isNull } from "drizzle-orm";

import type { UserDrizzle } from "@/db/drizzle";
import { listEntries, lists, srsCards } from "@/db/schema";
import { createNewCard } from "@/stores/srs";
import { makeDefaultListId } from "./seed-default-lists";
import type { CourseFrame } from "./rtk-course";

/**
 * A cracked node's frames become real flashcards. The course introduces; FSRS
 * retains — and the list they land in already exists: `seedRtkLessonsIfNeeded`
 * seeds `RTK Lesson 1..56` with each lesson's kanji in frame order.
 */

export function lessonListId(unit: number): string {
  return makeDefaultListId(`RTK Lesson ${unit}`);
}

/**
 * Derived, not random. Two devices crowning the same node offline would
 * otherwise write two rows with different UUIDs, both push (default-list cards
 * DO sync), and nothing would reconcile them — the learner would review the
 * frame twice forever. With a derived primary key the second write collides and
 * is ignored.
 */
function cardId(unit: number, literal: string): string {
  return `rtk-card:${unit}:${literal}`;
}

function entryId(unit: number, literal: string): string {
  return `rtk-entry:${unit}:${literal}`;
}

/**
 * Whether this frame already has a card in the lesson's list. Deliberately the
 * CARD and not the list entry: `seedRtkLessonsIfNeeded` puts an entry there for
 * every kanji of every lesson, so an entry check would be true for all 2,200
 * frames and graduation would write nothing at all. `deleted_at` matters too,
 * or a frame the learner removed from the list could never be graduated again.
 */
async function hasEntry(db: UserDrizzle, listId: string, literal: string): Promise<boolean> {
  const rows = await db
    .select({ id: listEntries.id })
    .from(listEntries)
    .where(
      and(
        eq(listEntries.listId, listId),
        eq(listEntries.kanjiLiteral, literal),
        isNull(listEntries.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function alreadyCarded(db: UserDrizzle, listId: string, literal: string): Promise<boolean> {
  const rows = await db
    .select({ id: srsCards.id })
    .from(srsCards)
    .where(
      and(
        eq(srsCards.listId, listId),
        eq(srsCards.kanjiLiteral, literal),
        isNull(srsCards.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Cards for the frames of one node, skipping any already carded. Graduation runs
 * again at every crown, so without the check a frame drilled to crown 3 would
 * own three cards.
 */
export async function graduateFrames(
  db: UserDrizzle,
  frames: readonly CourseFrame[],
  unit: number,
): Promise<string[]> {
  const listId = lessonListId(unit);
  const now = new Date().toISOString();
  const added: string[] = [];

  // The seeding usually made it, but a learner can reach Learn before Lists —
  // and a card needs its list to exist.
  await db
    .insert(lists)
    .values({
      id: listId,
      name: `RTK Lesson ${unit}`,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  for (const frame of frames) {
    if (await alreadyCarded(db, listId, frame.literal)) continue;

    // Usually already there from seeding, and there is no unique index on
    // (list_id, kanji_literal) — so the id being derived is not enough to stop
    // a second row. Ask first.
    if (!(await hasEntry(db, listId, frame.literal))) {
      await db
        .insert(listEntries)
        .values({
          id: entryId(unit, frame.literal),
          listId,
          entryId: 0,
          kanjiLiteral: frame.literal,
          addedAt: now,
          position: frame.index,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    const card = createNewCard();
    await db
      .insert(srsCards)
      .values({
        id: cardId(unit, frame.literal),
        entryId: 0,
        kanjiLiteral: frame.literal,
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

    added.push(frame.literal);
  }

  return added;
}
