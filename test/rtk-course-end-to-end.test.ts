/**
 * The one claim the unit tests cannot make between them: that a learner who
 * drills a node ends up with cards they can actually study.
 *
 * It runs the REAL seeding against the REAL dictionary, the real queue, and the
 * real graduation — no mocks — and then asks the question the study screen asks.
 * Graduation was a no-op for the whole of this branch's history because the
 * membership test and the seeding disagreed, and nothing joined the two up.
 */
import Database from "better-sqlite3";
import type * as SQLite from "expo-sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getUserDrizzle, type UserDrizzle } from "@/db/drizzle";
import { loadNodeFrames, loadUnitShapes } from "@/db/rtk-frames";
import { awardCrown, getNodeProgress, markNodeSeen } from "@/db/rtk-progress";
import type { WrappedUserDb } from "@/db/user-db";
import { COURSE_RTK, nextCrown, stepsForCrown } from "@/lib/rtk-course";
import { graduateFrames, lessonListId } from "@/lib/rtk-graduate";
import { advance, currentItem, isComplete, startSession } from "@/lib/rtk-session";
import { seedRtkLessonsIfNeeded } from "@/lib/seed-default-lists";
import { createTestDb } from "@/test/test-db";
import { DICT_DB_PATH, hasDictDb } from "./dictionary-db";

const raw = hasDictDb ? new Database(DICT_DB_PATH, { readonly: true }) : null;
afterAll(() => raw?.close());

const dictDb = {
  getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
    raw!.prepare(sql).all(...(params ?? [])) as T[],
  getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> =>
    (raw!.prepare(sql).get(...(params ?? [])) as T) ?? null,
} as unknown as SQLite.SQLiteDatabase;

let userDb: WrappedUserDb & { close: () => void };
let drizzle: UserDrizzle;

const ref = { course: COURSE_RTK, unit: 1, node: 0 };

beforeEach(() => {
  if (userDb) userDb.close();
  userDb = createTestDb();
  drizzle = getUserDrizzle(userDb);
});

/** What the study screen would find for a list. */
async function studiable(listId: string): Promise<string[]> {
  const rows = await userDb.getAllAsync<{ kanji_literal: string }>(
    `SELECT kanji_literal FROM srs_cards
      WHERE list_id = ? AND deleted_at IS NULL AND entry_id = 0
      ORDER BY kanji_literal`,
    [listId],
  );
  return rows.map((row) => row.kanji_literal);
}

describe.skipIf(!hasDictDb)("a learner walks a node", () => {
  it("has the lesson lists before they start, and no cards", async () => {
    expect(await seedRtkLessonsIfNeeded(userDb, dictDb)).toBe(true);
    const entries = await userDb.getAllAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ?",
      [lessonListId(1)],
    );
    // Lesson 1 is 15 frames, listed and ready — and not yet studiable.
    expect(entries[0].n).toBe(15);
    expect(await studiable(lessonListId(1))).toEqual([]);
  });

  it("finishes the first pass and comes away with cards it can study", async () => {
    await seedRtkLessonsIfNeeded(userDb, dictDb);

    const frames = await loadNodeFrames(dictDb, ref);
    expect(frames.map((f) => f.literal).join("")).toBe("一二三四五");

    await markNodeSeen(userDb, ref);
    expect((await getNodeProgress(userDb, ref))?.crown).toBe(0);

    // The pass as the runner would drive it: every step of crown 0, answered.
    let session = startSession(frames, 0);
    const asked: string[] = [];
    let guard = 0;
    while (!isComplete(session) && guard++ < 100) {
      asked.push(`${currentItem(session)!.step}:${currentItem(session)!.frame.literal}`);
      session = advance(session, "hit");
    }
    expect(isComplete(session)).toBe(true);
    expect(asked).toHaveLength(stepsForCrown(0).length * frames.length);
    expect(asked.slice(0, 5)).toEqual(["meet:一", "meet:二", "meet:三", "meet:四", "meet:五"]);

    await awardCrown(userDb, ref, nextCrown(0));
    const graduated = await graduateFrames(drizzle, frames, ref.unit);

    expect((await getNodeProgress(userDb, ref))?.crown).toBe(1);
    expect(graduated).toEqual(["一", "二", "三", "四", "五"]);
    expect(await studiable(lessonListId(1))).toEqual(["一", "三", "二", "五", "四"].sort());
  });

  it("gives the same five frames one card each across all three crowns", async () => {
    await seedRtkLessonsIfNeeded(userDb, dictDb);
    const frames = await loadNodeFrames(dictDb, ref);

    for (const crown of [0, 1, 2]) {
      let session = startSession(frames, crown);
      let guard = 0;
      while (!isComplete(session) && guard++ < 100) session = advance(session, "hit");
      await awardCrown(userDb, ref, nextCrown(crown));
      await graduateFrames(drizzle, frames, ref.unit);
    }

    expect((await getNodeProgress(userDb, ref))?.crown).toBe(3);
    expect(await studiable(lessonListId(1))).toHaveLength(5);
    // And the fourth visit has nothing left to ask.
    expect(startSession(frames, 3).queue).toEqual([]);
  });

  it("does not hand back a crown the learner deleted", async () => {
    await seedRtkLessonsIfNeeded(userDb, dictDb);
    const frames = await loadNodeFrames(dictDb, ref);
    await awardCrown(userDb, ref, 3);

    const now = new Date().toISOString();
    await userDb.runAsync(
      "UPDATE course_progress SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL",
      [now, now],
    );

    await markNodeSeen(userDb, ref);
    expect((await getNodeProgress(userDb, ref))?.crown).toBe(0);
    expect(frames).toHaveLength(5);
  });

  it("covers the whole of volume 1 in 461 nodes", async () => {
    const units = await loadUnitShapes(dictDb);
    expect(units.reduce((n, unit) => n + unit.nodeCount, 0)).toBe(461);

    // Every node of the first unit is walkable, including its short tail.
    const lesson1 = units.find((unit) => unit.unit === 1)!;
    expect(lesson1.nodeCount).toBe(3);
    const sizes = await Promise.all(
      Array.from({ length: lesson1.nodeCount }, (_, node) =>
        loadNodeFrames(dictDb, { ...ref, node }).then((f) => f.length),
      ),
    );
    expect(sizes).toEqual([5, 5, 5]);
  });
});
