/**
 * A scope is SQL a query interpolates, so the tests run it against real SQLite
 * rather than asserting on the string: the point of the exercise is that one
 * session can draw from 56 lists without the cards moving anywhere.
 *
 * The LIKE comparison here is the record of why the scope takes exact ids. Two
 * of the three hazards bite this prefix; the third, `_` as a wildcard, belongs
 * to a prefix containing one — so the test says that plainly instead of
 * implying a danger that is not there.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/test-db";
import type { WrappedUserDb } from "@/db/user-db";
import { lessonListId } from "./rtk-graduate";
import { RTK_LESSON_COUNT } from "./rtk-course";
import { listSet, rtkLessonListIds, rtkReviewScope, singleList } from "./list-scope";

let db: WrappedUserDb & { close: () => void };

beforeEach(async () => {
  if (db) db.close();
  db = createTestDb();
  const now = new Date().toISOString();
  // The last three exist to pin what a LIKE prefix does: it sweeps up the id
  // that IS the prefix and one differing only in case, and it does NOT reach an
  // id with underscores — the `_` wildcard bites a pattern that contains one,
  // which is the hazard of a generic prefix helper and the reason there is none.
  const fixtures = [
    lessonListId(1),
    lessonListId(2),
    "my-list",
    "default-rtk-lesson-",
    "default-RTK-lesson-5",
    "default_rtk_lesson_7",
  ];
  for (const [i, listId] of fixtures.entries()) {
    await db.runAsync(
      "INSERT OR IGNORE INTO lists (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
      [listId, `list ${i}`, now, now],
    );
    await db.runAsync(
      `INSERT INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty,
         elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?, 0, 0, 0, 0, 0, 0, 2, 'kanji', 'english', ?, ?)`,
      [`card-${i}`, `k${i}`, listId, now, now, now],
    );
  }
});

afterAll(() => {
  if (db) db.close();
});

async function cardsIn(scope: {
  readonly clause: string;
  readonly args: readonly string[];
}): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM srs_cards WHERE ${scope.clause} AND deleted_at IS NULL ORDER BY id`,
    [...scope.args],
  );
  return rows.map((r) => r.id);
}

describe("one list", () => {
  it("draws from that list alone", async () => {
    expect(await cardsIn(singleList(lessonListId(1)))).toEqual(["card-0"]);
  });

  it("collapses a set of one, so the simple case stays the simple query", () => {
    const scope = listSet([lessonListId(1)]);
    expect(scope.clause).toBe("list_id = ?");
    expect(scope.multi).toBe(false);
  });
});

describe("a set of lists", () => {
  it("draws from every list in the set", async () => {
    expect(await cardsIn(listSet([lessonListId(1), lessonListId(2)]))).toEqual([
      "card-0",
      "card-1",
    ]);
  });

  it("draws from nothing else", async () => {
    const drawn = await cardsIn(listSet([lessonListId(1), lessonListId(2)]));
    expect(drawn).toEqual(["card-0", "card-1"]);
  });

  it("says it is more than one list, so a write-back can refuse", () => {
    expect(listSet([lessonListId(1), lessonListId(2)]).multi).toBe(true);
  });

  it("matches an id exactly, where a name pattern would over-reach", async () => {
    // Everything this run has to prove, in SQLite rather than in prose: the
    // pattern the plan started with takes three lists it has no business in.
    const like = { clause: "list_id LIKE ?", args: ["default-rtk-lesson-%"] };
    const swept = await cardsIn(like);
    expect(swept).toContain("card-3"); // the id that IS the prefix
    expect(swept).toContain("card-4"); // differs only in case
    expect(swept).not.toContain("card-5"); // hyphens are literal in the pattern

    const exact = await cardsIn(rtkReviewScope());
    expect(exact).toEqual(["card-0", "card-1"]);
  });

  it("refuses an empty set rather than matching everything", () => {
    expect(() => listSet([])).toThrow();
  });
});

describe("the course's own scope", () => {
  it("names every lesson list, and only those", () => {
    const ids = rtkLessonListIds();
    expect(ids).toHaveLength(RTK_LESSON_COUNT);
    expect(ids[0]).toBe("default-rtk-lesson-1");
    expect(ids[RTK_LESSON_COUNT - 1]).toBe(`default-rtk-lesson-${RTK_LESSON_COUNT}`);
    expect(new Set(ids).size).toBe(RTK_LESSON_COUNT);
  });

  it("binds every id, so none of them is ever part of the SQL", () => {
    const scope = rtkReviewScope();
    expect(scope.args).toHaveLength(RTK_LESSON_COUNT);
    expect(scope.clause).not.toContain("default-rtk");
    expect(scope.clause.match(/\?/g)).toHaveLength(RTK_LESSON_COUNT);
  });
});
