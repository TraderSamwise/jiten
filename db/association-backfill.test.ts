import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { runAssociationBackfill } from "./association-backfill";
import { createPrimitivesTable } from "../test/strokes-schema";

function asyncAdapter(d: Database.Database): SQLite.SQLiteDatabase {
  return {
    getAllAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      d.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).run(...params),
    withTransactionAsync: async (cb: () => Promise<void>) => {
      d.exec("BEGIN");
      try {
        await cb();
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;
}

const FLAG = "assoc_index_backfilled_v1";

let userRaw: Database.Database;
let strokesRaw: Database.Database;
let userDb: WrappedUserDb;
let strokesDb: SQLite.SQLiteDatabase;

beforeEach(() => {
  userRaw = new Database(":memory:");
  userRaw.exec(`
    CREATE TABLE user_kanji_notes (literal TEXT PRIMARY KEY, mnemonic TEXT, keyword TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE primitive_note_assoc (literal TEXT NOT NULL, word TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (literal, word, target));
    CREATE TABLE app_flags (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO user_kanji_notes (literal, mnemonic, deleted_at) VALUES ('宣', 'I proclaim in my house', NULL);
  `);
  strokesRaw = new Database(":memory:");
  createPrimitivesTable(strokesRaw);
  strokesRaw.exec(`
    CREATE TABLE kanji_primitives (literal TEXT, position INTEGER, glyph TEXT, primitive_id INTEGER, keyword TEXT, is_primitive INTEGER);
    INSERT INTO kanji_primitives VALUES ('宣', 0, NULL, 51, 'house', 1);
  `);
  userDb = asyncAdapter(userRaw) as unknown as WrappedUserDb;
  strokesDb = asyncAdapter(strokesRaw);
});

afterEach(() => {
  userRaw.close();
  strokesRaw.close();
});

function assocCount() {
  return (userRaw.prepare("SELECT COUNT(*) c FROM primitive_note_assoc").get() as { c: number }).c;
}
function flagValue() {
  return userRaw.prepare("SELECT value FROM app_flags WHERE key = ?").get(FLAG) as
    | { value: string }
    | undefined;
}

describe("runAssociationBackfill", () => {
  it("builds the index and sets the flag when strokes is present", async () => {
    await runAssociationBackfill(userDb, strokesDb);
    expect(assocCount()).toBeGreaterThan(0);
    expect(flagValue()).toEqual({ value: "1" });
  });

  it("no-ops and leaves the flag unset when strokes is missing (retries later)", async () => {
    await runAssociationBackfill(userDb, null);
    expect(assocCount()).toBe(0);
    expect(flagValue()).toBeUndefined();
  });

  it("does not rebuild once the flag is set", async () => {
    userRaw.prepare("INSERT INTO app_flags (key, value) VALUES (?, '1')").run(FLAG);
    // seed a stale row the rebuild would have wiped; the guard must leave it untouched
    userRaw
      .prepare(
        "INSERT INTO primitive_note_assoc (literal, word, target) VALUES ('x', 'stale', 'p9')",
      )
      .run();
    await runAssociationBackfill(userDb, strokesDb);
    expect(
      userRaw.prepare("SELECT COUNT(*) c FROM primitive_note_assoc WHERE word='stale'").get(),
    ).toEqual({ c: 1 });
  });

  it("is idempotent across repeated calls", async () => {
    await runAssociationBackfill(userDb, strokesDb);
    const first = assocCount();
    await runAssociationBackfill(userDb, strokesDb);
    expect(assocCount()).toBe(first);
  });
});
