/**
 * Graduation is the end of the crown ladder, and it is easy to make it a no-op.
 * The list it writes into is SEEDED with an entry for every kanji of the lesson,
 * so a membership test against `list_entries` is true for all 2,200 frames
 * before a single card exists — which is why these fixtures seed the entries the
 * way production does, and why the check is against the card.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getUserDrizzle, type UserDrizzle } from "@/db/drizzle";
import { createTestDb } from "@/test/test-db";
import type { WrappedUserDb } from "@/db/user-db";
import { graduateFrames, lessonListId } from "./rtk-graduate";
import type { CourseFrame } from "./rtk-course";

let rawDb: WrappedUserDb & { close: () => void };
let db: UserDrizzle;

const frames: CourseFrame[] = ["一", "二"].map((literal, i) => ({
  literal,
  index: i + 1,
  keyword: ["one", "two"][i],
  lesson: 1,
}));

/** The list AND its entries, exactly as seedRtkLessonsIfNeeded leaves them. */
async function seedAsProductionDoes(): Promise<void> {
  const now = new Date().toISOString();
  await rawDb.runAsync(
    "INSERT OR IGNORE INTO lists (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, NULL, 1, ?, ?)",
    [lessonListId(1), "RTK Lesson 1", now, now],
  );
  for (const [i, frame] of frames.entries()) {
    await rawDb.runAsync(
      "INSERT OR IGNORE INTO list_entries (id, list_id, entry_id, added_at, kanji_literal, position) VALUES (?, ?, 0, ?, ?, ?)",
      [`seeded-${i}`, lessonListId(1), now, frame.literal, i],
    );
  }
}

beforeEach(async () => {
  if (rawDb) rawDb.close();
  rawDb = createTestDb();
  db = getUserDrizzle(rawDb);
  await seedAsProductionDoes();
});

afterAll(() => {
  if (rawDb) rawDb.close();
});

async function cards(literal: string): Promise<number> {
  const rows = await rawDb.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM srs_cards WHERE kanji_literal = ? AND deleted_at IS NULL",
    [literal],
  );
  return rows[0].n;
}

async function entries(literal: string): Promise<number> {
  const rows = await rawDb.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM list_entries WHERE list_id = ? AND kanji_literal = ?",
    [lessonListId(1), literal],
  );
  return rows[0].n;
}

describe("graduating a node", () => {
  it("names the lesson's own default list", () => {
    expect(lessonListId(12)).toBe("default-rtk-lesson-12");
  });

  it("cards every frame even though the list already lists them", async () => {
    // The seeded entries are the trap: a list_entries check would skip all of them.
    expect(await entries("一")).toBe(1);
    const added = await graduateFrames(db, frames, 1);
    expect(added).toEqual(["一", "二"]);
    expect(await cards("一")).toBe(1);
    expect(await cards("二")).toBe(1);
  });

  it("does not duplicate the seeded entry", async () => {
    await graduateFrames(db, frames, 1);
    expect(await entries("一")).toBe(1);
  });

  it("gives it one card however many crowns it earns", async () => {
    await graduateFrames(db, frames, 1);
    const again = await graduateFrames(db, frames, 1);
    expect(again).toEqual([]);
    expect(await cards("一")).toBe(1);
  });

  it("writes the same card id on every device, so two cannot double up", async () => {
    await graduateFrames(db, frames, 1);
    const rows = await rawDb.getAllAsync<{ id: string }>(
      "SELECT id FROM srs_cards WHERE kanji_literal = ?",
      ["一"],
    );
    // Derived, not random: a second device's write collides and is ignored.
    expect(rows[0].id).toBe("rtk-card:1:一");
  });

  it("cards a frame again after the learner removed it from the list", async () => {
    await graduateFrames(db, frames, 1);
    const now = new Date().toISOString();
    await rawDb.runAsync(
      "UPDATE srs_cards SET deleted_at = ?, updated_at = ? WHERE kanji_literal = ?",
      [now, now, "二"],
    );
    const added = await graduateFrames(db, frames, 1);
    expect(added).toEqual(["二"]);
  });

  it("puts the card in the lesson's list, with the kanji sentinel", async () => {
    await graduateFrames(db, frames, 1);
    const rows = await rawDb.getAllAsync<{ list_id: string; entry_id: number }>(
      "SELECT list_id, entry_id FROM srs_cards WHERE kanji_literal = ?",
      ["一"],
    );
    expect(rows[0]).toMatchObject({ list_id: lessonListId(1), entry_id: 0 });
  });

  it("schedules the card as new, for FSRS to take over", async () => {
    await graduateFrames(db, frames, 1);
    const rows = await rawDb.getAllAsync<{ state: number; reps: number; front_mode: string }>(
      "SELECT state, reps, front_mode FROM srs_cards WHERE kanji_literal = ?",
      ["一"],
    );
    expect(rows[0]).toMatchObject({ state: 0, reps: 0, front_mode: "kanji" });
  });

  it("works for the learner who reaches Learn before Lists", async () => {
    // No seeding at all: graduation writes both the entry and the card.
    rawDb.close();
    rawDb = createTestDb();
    db = getUserDrizzle(rawDb);
    const added = await graduateFrames(db, frames, 1);
    expect(added).toEqual(["一", "二"]);
    expect(await entries("一")).toBe(1);
    expect(await cards("一")).toBe(1);
  });
});
