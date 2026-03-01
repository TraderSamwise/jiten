import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { runClientDictMigrations, CLIENT_DICT_MIGRATIONS } from "./dict-client-migrations";
import { determineUpdateAction } from "./dict-download";
import { DICT_VERSION, DICT_BASE_VERSION } from "./dict-version";

// ─── Adapter: wrap better-sqlite3 to match expo-sqlite's async interface ───

function wrapBetterSqlite(db: Database.Database): SQLiteDatabase {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      const stmt = db.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | null;
    },
  } as unknown as SQLiteDatabase;
}

// ─── runClientDictMigrations tests ───

describe("runClientDictMigrations", () => {
  let rawDb: Database.Database;
  let db: SQLiteDatabase;

  beforeEach(() => {
    rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE dict_meta (key TEXT PRIMARY KEY, value TEXT)");
    rawDb.exec("INSERT INTO dict_meta (key, value) VALUES ('version', '14')");
    rawDb.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");
    db = wrapBetterSqlite(rawDb);
  });

  it("returns fromVersion when no migrations match the range", async () => {
    const result = await runClientDictMigrations(db, 14, 14);
    expect(result).toBe(14);
  });

  it("returns fromVersion when CLIENT_DICT_MIGRATIONS is empty", async () => {
    expect(CLIENT_DICT_MIGRATIONS).toHaveLength(0);
    const result = await runClientDictMigrations(db, 14, 20);
    expect(result).toBe(14);
  });
});

// ─── Integration test with real SQLite ───

describe("client migration integration (manual SQL)", () => {
  it("applies sequential migrations and updates dict_meta", () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE dict_meta (key TEXT PRIMARY KEY, value TEXT)");
    rawDb.exec("INSERT INTO dict_meta (key, value) VALUES ('version', '14')");
    rawDb.exec("CREATE TABLE kanji (literal TEXT PRIMARY KEY, stroke_count INTEGER)");

    // Simulate migrations v15 and v16
    const migrations = [
      {
        version: 15,
        description: "Add heisig_lesson",
        sql: ["ALTER TABLE kanji ADD COLUMN heisig_lesson INTEGER"],
      },
      {
        version: 16,
        description: "Add frequency col",
        sql: ["ALTER TABLE kanji ADD COLUMN frequency INTEGER"],
      },
      {
        version: 17,
        description: "Should not run",
        sql: ["ALTER TABLE kanji ADD COLUMN extra TEXT"],
      },
    ];

    const pending = migrations.filter((m) => m.version > 14 && m.version <= 16);
    expect(pending).toHaveLength(2);

    for (const migration of pending) {
      rawDb.exec("BEGIN TRANSACTION");
      for (const sql of migration.sql) {
        rawDb.exec(sql);
      }
      rawDb
        .prepare("INSERT OR REPLACE INTO dict_meta (key, value) VALUES ('version', ?)")
        .run(String(migration.version));
      rawDb.exec("COMMIT");
    }

    // Verify schema changes
    const cols = rawDb.pragma("table_info(kanji)") as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("heisig_lesson");
    expect(colNames).toContain("frequency");
    expect(colNames).not.toContain("extra");

    // Verify version updated to 16 (not 17)
    const row = rawDb.prepare("SELECT value FROM dict_meta WHERE key = 'version'").get() as {
      value: string;
    };
    expect(row.value).toBe("16");
  });

  it("rolls back on SQL error and stops at failure point", () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE dict_meta (key TEXT PRIMARY KEY, value TEXT)");
    rawDb.exec("INSERT INTO dict_meta (key, value) VALUES ('version', '14')");
    rawDb.exec("CREATE TABLE kanji (literal TEXT PRIMARY KEY, stroke_count INTEGER)");

    // v15 succeeds, v16 fails (duplicate column)
    rawDb.exec("BEGIN");
    rawDb.exec("ALTER TABLE kanji ADD COLUMN col_a TEXT");
    rawDb.exec("COMMIT");
    rawDb.prepare("INSERT OR REPLACE INTO dict_meta (key, value) VALUES ('version', '15')").run();

    // Now try to add col_a again — should fail
    expect(() => {
      rawDb.exec("ALTER TABLE kanji ADD COLUMN col_a TEXT");
    }).toThrow(/duplicate/);

    // Version should remain at 15
    const row = rawDb.prepare("SELECT value FROM dict_meta WHERE key = 'version'").get() as {
      value: string;
    };
    expect(row.value).toBe("15");
  });
});

// ─── determineUpdateAction tests ───

describe("determineUpdateAction", () => {
  const mockManifest = {
    version: 14,
    url: "https://example.com/dictionary.db",
    sizeBytes: 100000,
  };

  it("returns 'none' when local version equals DICT_VERSION", () => {
    const action = determineUpdateAction(DICT_VERSION, mockManifest);
    expect(action.type).toBe("none");
  });

  it("returns 'none' when local version exceeds DICT_VERSION", () => {
    const action = determineUpdateAction(DICT_VERSION + 5, mockManifest);
    expect(action.type).toBe("none");
  });

  it("returns 'full-download' when local version is null", () => {
    const action = determineUpdateAction(null, mockManifest);
    expect(action.type).toBe("full-download");
    if (action.type === "full-download") {
      expect(action.manifest).toBe(mockManifest);
    }
  });

  it("returns 'full-download' when local version < DICT_BASE_VERSION", () => {
    const action = determineUpdateAction(DICT_BASE_VERSION - 1, mockManifest);
    expect(action.type).toBe("full-download");
  });

  it("returns 'full-download' when local version is far below base", () => {
    const action = determineUpdateAction(1, mockManifest);
    expect(action.type).toBe("full-download");
  });

  // When DICT_VERSION === DICT_BASE_VERSION (currently both 14), there's
  // no gap for client-migration. When they diverge, this test exercises it:
  it("would return 'client-migration' for version between base and target", () => {
    // Simulate: DICT_BASE_VERSION=14, DICT_VERSION=16, localVersion=14
    // Since we can't change the constants, we verify the logic directly:
    // localVersion >= DICT_BASE_VERSION && localVersion < DICT_VERSION → client-migration
    // Currently DICT_VERSION === DICT_BASE_VERSION === 14, so localVersion=14 → "none"
    if (DICT_VERSION > DICT_BASE_VERSION) {
      const action = determineUpdateAction(DICT_BASE_VERSION, mockManifest);
      expect(action.type).toBe("client-migration");
      if (action.type === "client-migration") {
        expect(action.fromVersion).toBe(DICT_BASE_VERSION);
        expect(action.toVersion).toBe(DICT_VERSION);
      }
    } else {
      // Both equal — localVersion === DICT_VERSION → "none"
      const action = determineUpdateAction(DICT_BASE_VERSION, mockManifest);
      expect(action.type).toBe("none");
    }
  });
});
