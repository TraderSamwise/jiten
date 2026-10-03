import { and, eq } from "drizzle-orm";

import type { UserDrizzle } from "@/db/drizzle";
import { listEntries } from "@/db/schema";
import { writeKanjiToList } from "./quick-bookmark";
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

async function alreadyIn(db: UserDrizzle, listId: string, literal: string): Promise<boolean> {
  const rows = await db
    .select({ id: listEntries.id })
    .from(listEntries)
    .where(and(eq(listEntries.listId, listId), eq(listEntries.kanjiLiteral, literal)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Cards for the frames of one node, skipping any already carded. Graduation
 * runs again at every crown and each write inserts a fresh row, so without the
 * check a frame drilled to crown 3 would own three cards.
 */
export async function graduateFrames(
  db: UserDrizzle,
  frames: readonly CourseFrame[],
  unit: number,
): Promise<string[]> {
  const listId = lessonListId(unit);
  const now = new Date().toISOString();
  const added: string[] = [];
  for (const frame of frames) {
    if (await alreadyIn(db, listId, frame.literal)) continue;
    await writeKanjiToList(db, frame.literal, listId, now);
    added.push(frame.literal);
  }
  return added;
}
