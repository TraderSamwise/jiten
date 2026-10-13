/**
 * The one-time repair of decks the lapse bug flattened.
 *
 * Fixing the rule does not fix the stored intervals: a card the bug ratcheted
 * is sitting at the 8-hour floor and comes back every day forever. Measured at
 * 200 answers a day, 3,579 of 8,000 such cards are still queued a year later
 * without a repair and 47 with one — `yarn simulate:srs drain`, and the
 * decisions are in docs/simple-srs-decisions.md.
 *
 * What must NOT move: a card that has barely been seen, a card on a healthy
 * interval, an FSRS-only card, and any learning card — a card at stage 0 sits
 * at 1/3 because that is where new cards start, and with the whole list loading
 * as new those are most of the stage-0 population.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { USER_DB_MIGRATIONS } from "./user-migrations";

const SPREADS = USER_DB_MIGRATIONS.filter((sql) =>
  /simple_interval = \d+ \+ \(rowid % \d+\)/.test(sql),
);
const REPAIR_AT = USER_DB_MIGRATIONS.indexOf(SPREADS[0]);
if (SPREADS.length !== 1) {
  // A second spreading migration would be silently untested otherwise.
  throw new Error(`expected exactly one interval repair migration, found ${SPREADS.length}`);
}
const BEFORE = USER_DB_MIGRATIONS.slice(0, REPAIR_AT);
const REPAIR = USER_DB_MIGRATIONS.slice(REPAIR_AT, REPAIR_AT + 1);

function apply(db: Database.Database, statements: readonly string[]) {
  for (const sql of statements) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
}

type Card = {
  id: string;
  stage: number | null;
  n: number | null;
  interval: number | null;
  reps: number;
  lapses: number;
  relearning?: number;
  run?: number;
  deleted?: boolean;
};

function insert(db: Database.Database, c: Card) {
  db.exec(`INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days,
    scheduled_days, reps, lapses, state, front_mode, back_mode, simple_stage, simple_n,
    simple_interval, simple_relearning, simple_run, created_at, updated_at)
    VALUES ('${c.id}', 1, 'l', 'x', 0, 0, 0, 0, ${c.reps}, ${c.lapses}, 0, 'kanji', 'english',
      ${c.stage ?? "NULL"}, ${c.n ?? "NULL"}, ${c.interval ?? "NULL"},
      ${c.relearning ?? 0}, ${c.run ?? 0}, 'created', 'OLD')`);
  if (c.deleted) db.exec(`UPDATE srs_cards SET deleted_at = 'gone' WHERE id = '${c.id}'`);
}

const FLOOR = 1 / 3;

/** Days since 2001-01-01, the epoch `simple_n` is in. */
const today = () => (Date.now() - Date.parse("2001-01-01T00:00:00Z")) / 86_400_000;

function repaired() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  apply(db, BEFORE);
  insert(db, { id: "ratcheted", stage: 1, n: 0, interval: FLOOR, reps: 40, lapses: 5 });
  insert(db, {
    id: "mid-lapse",
    stage: 0,
    n: 0,
    interval: FLOOR,
    reps: 40,
    lapses: 6,
    relearning: 1,
    run: 2,
  });
  insert(db, { id: "barely-seen", stage: 1, n: 9000, interval: FLOOR, reps: 4, lapses: 1 });
  insert(db, { id: "never-failed", stage: 1, n: 9000, interval: FLOOR, reps: 40, lapses: 0 });
  insert(db, { id: "healthy", stage: 1, n: 9100, interval: 56.61, reps: 40, lapses: 2 });
  insert(db, { id: "part-way-down", stage: 1, n: 0, interval: 0.88, reps: 40, lapses: 5 });
  // Just above the clause: 0.4 is a halving step, and still left to climb.
  insert(db, { id: "just-above", stage: 1, n: 0, interval: 0.4, reps: 40, lapses: 5 });
  // A list moved from FSRS to simple SRS carries its FSRS reps and lapses.
  insert(db, { id: "was-fsrs", stage: 1, n: 0, interval: 1 / 3, reps: 40, lapses: 5 });
  insert(db, {
    id: "deleted",
    stage: 1,
    n: 0,
    interval: FLOOR,
    reps: 40,
    lapses: 5,
    deleted: true,
  });
  insert(db, { id: "unseen", stage: null, n: null, interval: null, reps: 0, lapses: 0 });
  insert(db, { id: "fsrs-only", stage: null, n: null, interval: null, reps: 5, lapses: 1 });
  apply(db, REPAIR);
  return db;
}

const row = (db: Database.Database, id: string) =>
  db.prepare("SELECT * FROM srs_cards WHERE id = ?").get(id) as Record<string, number | string>;

describe("the interval repair", () => {
  it("lifts a ratcheted card off the floor and gives it a date inside the next month", () => {
    const r = row(repaired(), "ratcheted");
    expect(r.simple_interval).toBeGreaterThanOrEqual(2);
    expect(r.simple_interval).toBeLessThanOrEqual(30);
    expect(Number(r.simple_n) - today()).toBeGreaterThanOrEqual(2);
    expect(Number(r.simple_n) - today()).toBeLessThanOrEqual(30);
  });

  it("leaves updated_at alone, so a stale device cannot win last-write-wins", () => {
    // Each device repairs its own rows; a bumped timestamp would let a device
    // opened for the first time in months push its values over another's
    // reviews, because sync skips the remote row when `localTs >= remoteTs`.
    expect(row(repaired(), "ratcheted").updated_at).toBe("OLD");
  });

  it("leaves a card part-way down the ratchet to climb on its own", () => {
    // 0.88 days is not the floor: with the rule fixed it multiplies to 1.67,
    // 3.2, 6.1 … by itself. The clause is for cards PINNED at the floor, where
    // a card honestly at 0.88 after one lapse is indistinguishable from a
    // victim — at 75% accuracy, including them doubles the cards wrongly lifted.
    expect(row(repaired(), "part-way-down").simple_interval).toBe(0.88);
  });

  it("leaves a soft-deleted card alone rather than rewriting and pushing it", () => {
    expect(row(repaired(), "deleted").simple_interval).toBeCloseTo(FLOOR);
  });

  it("leaves a card with too few answers behind it alone", () => {
    // Honestly at the floor: a young card that failed once and re-graduated
    // lands there. Measured, those have a median of 4 answers; a card the
    // ratchet dragged down from 56 days has 32.
    expect(row(repaired(), "barely-seen").simple_interval).toBeCloseTo(FLOOR);
  });

  it("leaves every learning card alone, mid-lapse or never graduated", () => {
    const r = row(repaired(), "mid-lapse");
    // A stage-0 card is at 1/3 because that is where new cards start, and the
    // 8,000-card queue meant most of the deck never left stage 0. Lifting them
    // would hand unlearned words a fortnight; a genuinely ratcheted one climbs
    // 0.33 → 0.63 → 1.2 on its own once the rule is fixed.
    expect(r.simple_interval).toBeCloseTo(FLOOR);
    expect(r.simple_n).toBe(0);
    expect(r.updated_at).toBe("OLD");
  });

  it("leaves a card one halving above the clause alone", () => {
    expect(row(repaired(), "just-above").simple_interval).toBe(0.4);
  });

  it("leaves a card that has never failed alone — the bug cannot have touched it", () => {
    expect(row(repaired(), "never-failed").simple_interval).toBeCloseTo(FLOOR);
  });

  it("leaves a healthy interval and an FSRS-only card alone", () => {
    const db = repaired();
    expect(row(db, "healthy").simple_interval).toBe(56.61);
    expect(row(db, "fsrs-only").simple_interval).toBe(null);
  });

  it("rewrites the schedule and nothing else", () => {
    const r = row(repaired(), "ratcheted");
    // History is not the schedule: a repair that reset these would erase the
    // evidence the next repair, and the statistics screen, read.
    expect(r.reps).toBe(40);
    expect(r.lapses).toBe(5);
    expect(r.simple_stage).toBe(1);
    expect(r.simple_relearning).toBe(0);
    expect(r.simple_run).toBe(0);
    expect(r.created_at).toBe("created");
    expect(r.updated_at).toBe("OLD");
  });

  // Recorded, not asserted as desirable: `reps` is not per-mode, so a list
  // switched from FSRS to simple SRS brings its FSRS count with it and its cards
  // qualify after one simple graduation. Nothing in the row can tell them apart.
  it("lifts a card whose reps were earned under FSRS", () => {
    expect(Number(row(repaired(), "was-fsrs").simple_interval)).toBeGreaterThanOrEqual(2);
  });

  it("spreads the deck instead of stacking it on one day", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    apply(db, BEFORE);
    for (let i = 0; i < 300; i++) {
      insert(db, { id: `c${i}`, stage: 1, n: 0, interval: FLOOR, reps: 40, lapses: 5 });
    }
    apply(db, REPAIR);
    const spread = db
      .prepare(
        `SELECT count(DISTINCT simple_interval) d, min(simple_interval) lo,
           max(simple_interval) hi FROM srs_cards`,
      )
      .get() as { d: number; lo: number; hi: number };
    expect(spread.d).toBe(29);
    expect(spread.lo).toBe(2);
    expect(spread.hi).toBe(30);
  });

  it("runs once: a repaired row no longer matches, whichever device replays it", () => {
    const db = repaired();
    const before = row(db, "ratcheted");
    apply(db, REPAIR);
    expect(row(db, "ratcheted")).toEqual(before);
  });
});
