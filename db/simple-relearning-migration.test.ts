/**
 * The backfill that comes with `simple_relearning`.
 *
 * Cards sitting in a lapse when the column lands are relearning by definition,
 * and the column's `DEFAULT 0` would quietly forgive their halving. Cards that
 * merely failed at some point in the past must NOT be marked — that lifetime
 * reading is the bug this column exists to end.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { USER_DB_MIGRATIONS } from "./user-migrations";

/**
 * Split at the statements this change added, found by what they say rather than
 * by counting from the end of the array — later phases append more migrations,
 * and a `slice(-2)` silently starts testing the wrong pair.
 */
const ADD_COLUMN = USER_DB_MIGRATIONS.findIndex((sql) =>
  /ALTER TABLE srs_cards ADD COLUMN simple_relearning/.test(sql),
);
const BACKFILL = USER_DB_MIGRATIONS.findIndex((sql) =>
  /UPDATE srs_cards SET simple_relearning = 1/.test(sql),
);
if (ADD_COLUMN < 0 || BACKFILL !== ADD_COLUMN + 1) {
  throw new Error("the simple_relearning migrations are not where this test expects them");
}
const BEFORE = USER_DB_MIGRATIONS.slice(0, ADD_COLUMN);
const ADDED = USER_DB_MIGRATIONS.slice(ADD_COLUMN, BACKFILL + 1);

function apply(db: Database.Database, statements: readonly string[]) {
  for (const sql of statements) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
}

function card(id: string, stage: number | null, lapses: number) {
  return `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days,
    scheduled_days, reps, lapses, state, front_mode, back_mode, simple_stage, simple_n,
    simple_interval, created_at, updated_at)
    VALUES ('${id}', 1, 'l', 'x', 0, 0, 0, 0, 9, ${lapses}, 0, 'kanji', 'english',
      ${stage === null ? "NULL" : stage}, 0, 56.61, 'created', 'OLD')`;
}

describe("the simple_relearning backfill", () => {
  const migrated = () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    apply(db, BEFORE);
    db.exec(card("mid-lapse", 0, 4));
    db.exec(card("graduated", 1, 4));
    db.exec(card("never-seen", null, 0));
    db.exec(card("deleted-mid-lapse", 0, 4));
    db.exec("UPDATE srs_cards SET deleted_at = 'gone' WHERE id = 'deleted-mid-lapse'");
    apply(db, ADDED);
    return db;
  };

  it("marks a card that is in a lapse right now", () => {
    const row = migrated().prepare("SELECT * FROM srs_cards WHERE id = 'mid-lapse'").get() as any;
    expect(row.simple_relearning).toBe(1);
  });

  it("leaves a graduated card alone however often it has failed", () => {
    const row = migrated().prepare("SELECT * FROM srs_cards WHERE id = 'graduated'").get() as any;
    expect(row.simple_relearning).toBe(0);
    expect(row.updated_at).toBe("OLD");
  });

  it("leaves an unseen card at zero", () => {
    const row = migrated().prepare("SELECT * FROM srs_cards WHERE id = 'never-seen'").get() as any;
    expect(row.simple_relearning).toBe(0);
  });

  it("leaves updated_at alone, so a stale device cannot win last-write-wins", () => {
    // Every device runs this statement over its own rows, so the backfill does
    // not need to travel. Bumping the timestamp would make a device that has
    // not been opened in months the newest writer of every lapsed card: sync
    // skips the remote row when `localTs >= remoteTs` and pushes the stale one.
    const row = migrated().prepare("SELECT * FROM srs_cards WHERE id = 'mid-lapse'").get() as any;
    expect(row.updated_at).toBe("OLD");
  });

  it("leaves a soft-deleted card alone, so it cannot be resurrected by a push", () => {
    const db = migrated();
    const row = db.prepare("SELECT * FROM srs_cards WHERE id = 'deleted-mid-lapse'").get() as any;
    expect(row.simple_relearning).toBe(0);
    expect(row.updated_at).toBe("OLD");
  });
});
