/**
 * The queries that fill a simple-SRS session, run through the shipped
 * `loadSimpleQueuePools` rather than a retyped copy of its SQL.
 *
 * This file exists because review proved the previous version did not gate
 * anything: `lib/new-per-session.test.ts` typed the queries out again inside
 * the test, so deleting the cap from the screen, deleting the learning LIMIT,
 * or flipping its ORDER BY all left the whole suite green.
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { loadSimpleQueuePools, type SimpleQueueQuerier } from "./simple-queue";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import type { SrsCardRow } from "./types";
import { DEFAULT_NEW_PER_SESSION, UNLIMITED } from "@/stores/simple-srs";

/** Days since 2001-01-01, the epoch `simple_n` is stored in. */
const CUTOFF = (Date.now() - Date.parse("2001-01-01T00:00:00Z")) / 86_400_000 + 1;

type Card = {
  id: string;
  stage: number | null;
  n: number | null;
  /** ISO timestamp; `updated_at` is the learning slice's ordering key. */
  updatedAt?: string;
  /** Deliberately set against rowid order, so the ORDER BY is what sorts. */
  createdAt?: string;
  deleted?: boolean;
};

let db: Database.Database;

const query: SimpleQueueQuerier = async (sql, args) =>
  db.prepare(sql).all(...(args as unknown[])) as SrsCardRow[];

const scope = { clause: "list_id = ?", args: ["l"] };

function insert(c: Card) {
  db.prepare(
    `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days,
      scheduled_days, reps, lapses, state, front_mode, back_mode, simple_stage, simple_n,
      simple_interval, created_at, updated_at, deleted_at)
     VALUES (?, 1, 'l', 'x', 0, 0, 0, 0, 3, 1, 0, 'kanji', 'english', ?, ?, 0.3333, ?, ?, ?)`,
  ).run(
    c.id,
    c.stage,
    c.n,
    c.createdAt ?? `created-${c.id}`,
    c.updatedAt ?? "2026-01-01T00:00:00.000Z",
    c.deleted ? "gone" : null,
  );
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  for (const sql of USER_DB_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
});

/** `newCap` is the list's setting; `allowance` is what the session has left. */
const pools = (newCap: number, excludeIds?: Set<string>, newAllowance?: number) =>
  loadSimpleQueuePools({ query, scope, dueCutoffDays: CUTOFF, newCap, newAllowance, excludeIds });

const ids = (rows: SrsCardRow[]) => rows.map((r) => r.id);

describe("the new-card cap", () => {
  it("introduces the allowance, not the list", async () => {
    for (let i = 0; i < 8000; i++) insert({ id: `n${i}`, stage: null, n: null });
    expect((await pools(DEFAULT_NEW_PER_SESSION)).newRows).toHaveLength(10);
  });

  it("introduces the oldest first, whatever order the rows were written in", async () => {
    // created_at runs against rowid here on purpose: with the two agreeing,
    // deleting the ORDER BY entirely still passed.
    for (let i = 0; i < 20; i++) {
      const day = String(20 - i).padStart(2, "0");
      insert({ id: `n${i}`, stage: null, n: null, createdAt: `2026-01-${day}` });
    }
    expect(ids((await pools(3)).newRows)).toEqual(["n19", "n18", "n17"]);
  });

  it("gives an ephemeral session every unseen card", async () => {
    for (let i = 0; i < 45; i++) insert({ id: `n${i}`, stage: null, n: null });
    expect((await pools(UNLIMITED)).newRows).toHaveLength(45);
  });

  it("introduces nothing once the session has spent its allowance", async () => {
    for (let i = 0; i < 50; i++) insert({ id: `n${i}`, stage: null, n: null });
    expect((await pools(10, undefined, 0)).newRows).toHaveLength(0);
  });

  it("keeps serving the cards in learning after the allowance is spent", async () => {
    // The learning slice is sized from the list's cap, never from what is left
    // of it: keying it off the allowance emptied the whole queue once the
    // session had introduced its new cards, and a mid-session settings save —
    // which now rebuilds the queue — sent the session to the done screen with
    // cards still owed.
    for (let i = 0; i < 20; i++) insert({ id: `l${i}`, stage: 0, n: 0 });
    for (let i = 0; i < 20; i++) insert({ id: `n${i}`, stage: null, n: null });
    const { dueRows, newRows } = await pools(10, undefined, 0);
    expect(newRows).toHaveLength(0);
    expect(dueRows).toHaveLength(20);
  });
});

describe("the learning slice", () => {
  it("is bounded at three times the new cap", async () => {
    // A deck the uncapped session left behind: every card in learning, every
    // one due, which is the queue that came back unchanged every day.
    for (let i = 0; i < 8000; i++) insert({ id: `l${i}`, stage: 0, n: 0 });
    expect((await pools(DEFAULT_NEW_PER_SESSION)).dueRows).toHaveLength(30);
  });

  // A guard, not a gate: this passes without the `rowid ASC` tiebreak too,
  // because SQLite happens to return rowid order for equal keys. The tiebreak
  // makes that a promise rather than a coincidence — the backfill stamps every
  // card the same `updated_at` and there is no index on it.
  it("breaks a shared timestamp on rowid, so the slice is the same every build", async () => {
    for (let i = 0; i < 40; i++) insert({ id: `l${i}`, stage: 0, n: 0, updatedAt: "same" });
    const first = ids((await pools(DEFAULT_NEW_PER_SESSION)).dueRows);
    expect(first).toEqual(ids((await pools(DEFAULT_NEW_PER_SESSION)).dueRows));
    expect(first[0]).toBe("l0");
  });

  it("takes the most recently answered first, so cards in hand get finished", async () => {
    insert({ id: "old", stage: 0, n: 0, updatedAt: "2026-01-01T00:00:00.000Z" });
    insert({ id: "newest", stage: 0, n: 0, updatedAt: "2026-06-01T00:00:00.000Z" });
    insert({ id: "middle", stage: 0, n: 0, updatedAt: "2026-03-01T00:00:00.000Z" });
    const { dueRows } = await pools(1);
    expect(ids(dueRows)).toEqual(["newest", "middle", "old"]);
  });

  it("leads the queue, ahead of the graduated cards due today", async () => {
    insert({ id: "graduated", stage: 1, n: 0 });
    insert({ id: "learning", stage: 0, n: 0 });
    expect(ids((await pools(1)).dueRows)).toEqual(["learning", "graduated"]);
  });

  it("is unbounded for an ephemeral session", async () => {
    for (let i = 0; i < 60; i++) insert({ id: `l${i}`, stage: 0, n: 0 });
    expect((await pools(UNLIMITED)).dueRows).toHaveLength(60);
  });
});

describe("the graduated slice", () => {
  it("is never capped — it is the review load the learner owes", async () => {
    for (let i = 0; i < 500; i++) insert({ id: `g${i}`, stage: 1, n: 0 });
    expect((await pools(DEFAULT_NEW_PER_SESSION)).dueRows).toHaveLength(500);
  });

  it("includes a card due exactly on the cutoff, and excludes one past it", async () => {
    insert({ id: "today", stage: 1, n: CUTOFF - 1 });
    insert({ id: "on-the-cutoff", stage: 1, n: CUTOFF });
    insert({ id: "tomorrow", stage: 1, n: CUTOFF + 1 });
    expect(ids((await pools(1)).dueRows)).toEqual(["today", "on-the-cutoff"]);
  });

  it("still serves a card whose stage is outside the engine's 0 and 1", async () => {
    // Splitting the old `simple_stage IS NOT NULL` query in two could drop such
    // a row from every slice and strand it forever, so the graduated slice asks
    // for `!= 0` rather than `= 1`.
    insert({ id: "odd", stage: 2, n: 0 });
    expect(ids((await pools(1)).dueRows)).toEqual(["odd"]);
  });

  it("comes back in due order, oldest first", async () => {
    insert({ id: "later", stage: 1, n: CUTOFF - 1 });
    insert({ id: "earlier", stage: 1, n: CUTOFF - 5 });
    expect(ids((await pools(1)).dueRows)).toEqual(["earlier", "later"]);
  });
});

describe("cards already answered this session", () => {
  it("are held back, so Continue Studying does not re-serve them", async () => {
    // A graduated card's 0.633-day interval falls inside today's cutoff, so
    // without this it comes straight back on the next queue build.
    insert({ id: "just-passed", stage: 1, n: CUTOFF - 0.2 });
    insert({ id: "still-due", stage: 1, n: CUTOFF - 1 });
    const { dueRows } = await pools(1, new Set(["just-passed"]));
    expect(ids(dueRows)).toEqual(["still-due"]);
  });

  it("do not eat the cap they are excluded from", async () => {
    // The LIMIT would otherwise spend its slots on the excluded rows and hand
    // back a short batch.
    for (let i = 0; i < 40; i++) insert({ id: `n${i}`, stage: null, n: null });
    const spent = new Set(Array.from({ length: 10 }, (_, i) => `n${i}`));
    const { newRows } = await pools(DEFAULT_NEW_PER_SESSION, spent);
    expect(newRows).toHaveLength(10);
    expect(ids(newRows)[0]).toBe("n10");
  });

  it("do not eat the learning slice either", async () => {
    for (let i = 0; i < 60; i++) {
      insert({
        id: `l${i}`,
        stage: 0,
        n: 0,
        updatedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
      });
    }
    const spent = new Set(["l59", "l58", "l57"]);
    const { dueRows } = await pools(DEFAULT_NEW_PER_SESSION, spent);
    expect(dueRows).toHaveLength(30);
    expect(ids(dueRows)).not.toContain("l59");
  });
});

describe("rows no session may see", () => {
  it("skips a soft-deleted card in every slice", async () => {
    insert({ id: "g", stage: 1, n: 0, deleted: true });
    insert({ id: "l", stage: 0, n: 0, deleted: true });
    insert({ id: "n", stage: null, n: null, deleted: true });
    const { dueRows, newRows } = await pools(DEFAULT_NEW_PER_SESSION);
    expect(dueRows).toHaveLength(0);
    expect(newRows).toHaveLength(0);
  });

  it("keeps the three slices disjoint", async () => {
    insert({ id: "g", stage: 1, n: 0 });
    insert({ id: "l", stage: 0, n: 0 });
    insert({ id: "n", stage: null, n: null });
    const { dueRows, newRows } = await pools(DEFAULT_NEW_PER_SESSION);
    expect(ids(dueRows).sort()).toEqual(["g", "l"]);
    expect(ids(newRows)).toEqual(["n"]);
  });
});
