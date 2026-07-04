import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateLegacyMnemonics, type MnemonicMigrationDb } from "./mnemonic-migration";

function asyncAdapter(d: Database.Database): MnemonicMigrationDb {
  return {
    getAllAsync: async <T>(sql: string, params: unknown[] = []) =>
      d.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) =>
      (d.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => d.prepare(sql).run(...params),
  };
}

let raw: Database.Database;
let db: MnemonicMigrationDb;

beforeEach(() => {
  raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE user_kanji_notes (
      literal TEXT PRIMARY KEY, mnemonic TEXT, keyword TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE app_flags (key TEXT PRIMARY KEY, value TEXT);
  `);
  db = asyncAdapter(raw);
});

afterEach(() => raw.close());

function insert(literal: string, mnemonic: string, updatedAt = "2020-01-01T00:00:00Z") {
  raw
    .prepare("INSERT INTO user_kanji_notes (literal, mnemonic, updated_at) VALUES (?, ?, ?)")
    .run(literal, mnemonic, updatedAt);
}

function get(literal: string) {
  return raw
    .prepare("SELECT mnemonic, updated_at FROM user_kanji_notes WHERE literal = ?")
    .get(literal) as { mnemonic: string; updated_at: string };
}

describe("migrateLegacyMnemonics", () => {
  it("converts legacy sigils and sets the flag", async () => {
    insert("安", "I **relax** in my *house*.");
    insert("plain", "no markup here");
    await migrateLegacyMnemonics(db);

    expect(get("安").mnemonic).toBe("I {self} in my [house].");
    expect(get("plain").mnemonic).toBe("no markup here");
    const flag = raw
      .prepare("SELECT value FROM app_flags WHERE key = ?")
      .get("mnemonic_markup_migrated_v1");
    expect(flag).toEqual({ value: "1" });
  });

  it("preserves updated_at (no sync churn)", async () => {
    insert("安", "my *house*", "2019-05-05T12:00:00Z");
    await migrateLegacyMnemonics(db);
    expect(get("安").updated_at).toBe("2019-05-05T12:00:00Z");
  });

  it("does not run again once the flag is set (guarded)", async () => {
    raw
      .prepare("INSERT INTO app_flags (key, value) VALUES (?, '1')")
      .run("mnemonic_markup_migrated_v1");
    insert("安", "still *legacy*");
    await migrateLegacyMnemonics(db);
    expect(get("安").mnemonic).toBe("still *legacy*");
  });

  it("is idempotent — a second run on migrated text is a no-op", async () => {
    insert("安", "my *house*");
    await migrateLegacyMnemonics(db);
    const after = get("安").mnemonic;
    // clear the flag and re-run: already-converted text has no '*', so nothing changes
    raw.prepare("DELETE FROM app_flags WHERE key = ?").run("mnemonic_markup_migrated_v1");
    await migrateLegacyMnemonics(db);
    expect(get("安").mnemonic).toBe(after);
  });

  it("skips soft-deleted notes", async () => {
    raw
      .prepare(
        "INSERT INTO user_kanji_notes (literal, mnemonic, updated_at, deleted_at) VALUES (?, ?, ?, ?)",
      )
      .run("gone", "deleted *house*", "2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z");
    await migrateLegacyMnemonics(db);
    expect(get("gone").mnemonic).toBe("deleted *house*");
  });
});
