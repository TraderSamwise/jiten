/**
 * The hydration, which nothing else gates.
 *
 * The lapse fix turns on one alias surviving the SELECT: drop
 * `simple_relearning as simpleRelearning` and `card.simpleRelearning` is
 * `undefined`, so `=== 1` is false, the halving never fires, and every unit
 * test in stores/simple-srs.test.ts still passes. This reads a row back the
 * way the study screen does and hands it to the real decision.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { USER_DB_MIGRATIONS } from "./user-migrations";
import { SRS_CARD_SELECT } from "./srs-card-columns";
import { nextSimpleReview } from "@/stores/simple-srs";
import type { SrsCardRow } from "./types";

function dbWithCard(relearning: number): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  for (const sql of USER_DB_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
  db.exec(`INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days,
    scheduled_days, reps, lapses, state, front_mode, back_mode, simple_stage, simple_n,
    simple_interval, simple_relearning, created_at, updated_at)
    VALUES ('c', 1, 'l', 'x', 0, 0, 0, 0, 9, 3, 0, 'kanji', 'english', 1, 0, 56.61,
      ${relearning}, 'now', 'now')`);
  return db;
}

const read = (db: Database.Database) =>
  db.prepare(`${SRS_CARD_SELECT} FROM srs_cards WHERE id = 'c'`).get() as SrsCardRow;

describe("a card read back the way the study screen reads it", () => {
  it("carries simpleRelearning, so a card in a lapse halves once", () => {
    const card = read(dbWithCard(1));
    expect(card.simpleRelearning).toBe(1);
    expect(nextSimpleReview(card, "pass", 0).updates.simpleInterval).toBeCloseTo(28.305, 3);
  });

  it("and a card that merely failed long ago keeps growing", () => {
    const card = read(dbWithCard(0));
    expect(card.simpleRelearning).toBe(0);
    expect(card.lapses).toBe(3); // the lifetime counter the bug used to read
    expect(nextSimpleReview(card, "pass", 0).updates.simpleInterval).toBeCloseTo(56.61 * 1.9, 2);
  });
});
