/**
 * The cap on unseen cards a session introduces.
 *
 * The simple-SRS session used to load the whole list: 8,000 words meant 8,000
 * cards at once, none of which could collect the three correct answers a card
 * needs to graduate, so the same queue came back every day. Midori, which this
 * engine clones, mixes in about ten.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { USER_DB_MIGRATIONS } from "@/db/user-migrations";
import { SRS_CARD_SELECT } from "@/db/srs-card-columns";
import {
  DEFAULT_NEW_PER_SESSION,
  learningCapFor,
  resolveNewPerSession,
  SIMPLE_SRS_REQUIRED_CORRECT,
  UNLIMITED,
} from "@/stores/simple-srs";

describe("resolveNewPerSession", () => {
  it("falls back to the default when the list says nothing", () => {
    expect(resolveNewPerSession(null)).toBe(DEFAULT_NEW_PER_SESSION);
    expect(resolveNewPerSession(undefined)).toBe(DEFAULT_NEW_PER_SESSION);
  });

  it("never returns zero, which would send a session straight to the done screen", () => {
    expect(resolveNewPerSession(0)).toBe(1);
    expect(resolveNewPerSession(-5)).toBe(1);
  });

  it("keeps a chosen value and caps the absurd", () => {
    expect(resolveNewPerSession(25)).toBe(25);
    expect(resolveNewPerSession(10_000)).toBe(500);
  });
});

describe("the query that fills the new pool", () => {
  function deck(size: number): Database.Database {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    for (const sql of USER_DB_MIGRATIONS) {
      try {
        db.exec(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    const insert = db.prepare(`INSERT INTO srs_cards (id, entry_id, list_id, due, stability,
      difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode,
      created_at, updated_at) VALUES (?, ?, 'l', 'x', 0, 0, 0, 0, 0, 0, 0, 'kanji', 'english',
      'same-timestamp', 'now')`);
    // Every card carries the SAME created_at, the way the backfill writes them.
    for (let i = 0; i < size; i++) insert.run(`c${i}`, i);
    return db;
  }

  const newRows = (db: Database.Database, cap: number) =>
    db
      .prepare(
        `${SRS_CARD_SELECT} FROM srs_cards
         WHERE list_id = 'l' AND simple_stage IS NULL AND deleted_at IS NULL
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(cap);

  it("hands the session the cap, not the list", () => {
    expect(newRows(deck(8000), DEFAULT_NEW_PER_SESSION)).toHaveLength(10);
  });

  // A guard, not a gate: this passes without the `rowid ASC` tiebreak too,
  // because SQLite happens to return rowid order for equal keys. The tiebreak
  // is there to make that a promise rather than a coincidence — the backfill
  // stamps every card the same `created_at`, and there is no index on it.
  it("is stable when every card shares a timestamp", () => {
    const db = deck(50);
    const first = newRows(db, 10).map((r) => (r as { id: string }).id);
    expect(newRows(db, 10).map((r) => (r as { id: string }).id)).toEqual(first);
    // and it starts at the beginning of the list, not somewhere in the middle
    expect(first[0]).toBe("c0");
  });

  // What the ephemeral-list exemption binds: SQLite reads a negative LIMIT as
  // no limit, and -1 binds as an integer where a JS number past 2^31 would
  // reach op-sqlite as a double.
  it("gives everything to a session that asks for everything", () => {
    expect(newRows(deck(40), UNLIMITED)).toHaveLength(40);
  });
});

describe("learningCapFor", () => {
  it("is one new card's worth of work per learning card", () => {
    expect(learningCapFor(10)).toBe(10 * SIMPLE_SRS_REQUIRED_CORRECT);
    expect(learningCapFor(1)).toBe(SIMPLE_SRS_REQUIRED_CORRECT);
  });

  it("passes the ephemeral sentinel through instead of multiplying it", () => {
    expect(learningCapFor(UNLIMITED)).toBe(UNLIMITED);
  });
});

describe("the query that fills the learning slice of the due pool", () => {
  /** `size` cards at stage 0, all due, stamped in ascending `updated_at`. */
  function learningDeck(size: number): Database.Database {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    for (const sql of USER_DB_MIGRATIONS) {
      try {
        db.exec(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    const insert = db.prepare(`INSERT INTO srs_cards (id, entry_id, list_id, due, stability,
      difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode,
      simple_stage, simple_n, simple_interval, created_at, updated_at)
      VALUES (?, ?, 'l', 'x', 0, 0, 0, 0, 14, 2, 0, 'kanji', 'english', 0, 0, 0.3333,
      'created', ?)`);
    for (let i = 0; i < size; i++) {
      insert.run(`c${i}`, i, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`);
    }
    return db;
  }

  const learningRows = (db: Database.Database, cap: number) =>
    db
      .prepare(
        `${SRS_CARD_SELECT} FROM srs_cards
         WHERE list_id = 'l' AND simple_stage = 0 AND simple_n <= ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, rowid ASC
         LIMIT ?`,
      )
      .all(1, cap) as { id: string }[];

  it("bounds the cards in learning a session shows", () => {
    // The uncapped session left thousands of these, every one due, which is the
    // queue that came back unchanged every day. Three learning answers are one
    // card's worth of work, so the slice is three times the new cap.
    expect(learningRows(learningDeck(8000), learningCapFor(DEFAULT_NEW_PER_SESSION))).toHaveLength(
      30,
    );
  });

  it("takes the most recently answered first, so cards in hand get finished", () => {
    const rows = learningRows(learningDeck(60), 5);
    // c27 carries the latest updated_at (day 28); c55 shares it and loses the
    // rowid tiebreak.
    expect(rows[0].id).toBe("c27");
    expect(rows.map((r) => r.id)).toContain("c55");
  });

  it("gives an ephemeral session every learning card", () => {
    expect(learningRows(learningDeck(45), learningCapFor(UNLIMITED))).toHaveLength(45);
  });
});
