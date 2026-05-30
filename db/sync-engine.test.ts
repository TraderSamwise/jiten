/**
 * Sync engine integration tests.
 *
 * Uses two in-memory SQLite databases (via createTestDb) — one "local" and one
 * "remote" — with the remote wrapped in a mock Turso Client adapter. This lets
 * us test real SQL on both sides without network calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/test/test-db";
import { sync, isNetworkError } from "./sync-engine";
import type { WrappedUserDb } from "./user-db";
import type { Client, ResultSet, InStatement, TransactionMode, Row } from "@libsql/client/web";
import Database from "better-sqlite3";
import { USER_DB_MIGRATIONS } from "./user-migrations";

// ---------------------------------------------------------------------------
// Mock Turso Client — wraps a second in-memory SQLite as the "remote"
// ---------------------------------------------------------------------------

/** Convert better-sqlite3 rows to Turso-style Row objects (index + name access). */
function toTursoRows(columns: string[], rawRows: Record<string, any>[]): Row[] {
  return rawRows.map((raw) => {
    const row: any = { length: columns.length };
    columns.forEach((col, i) => {
      row[i] = raw[col] ?? null;
      row[col] = raw[col] ?? null;
    });
    return row as Row;
  });
}

function makeResultSet(columns: string[], rawRows: Record<string, any>[]): ResultSet {
  return {
    columns,
    columnTypes: columns.map(() => ""),
    rows: toTursoRows(columns, rawRows),
    rowsAffected: 0,
    lastInsertRowid: undefined as any,
    toJSON: () => ({}),
  };
}

function createMockTurso(db: Database.Database): Client {
  function exec(stmt: InStatement | string, args?: any[]): ResultSet {
    let sql: string;
    let params: any[];
    if (typeof stmt === "string") {
      sql = stmt;
      params = args ?? [];
    } else {
      sql = stmt.sql;
      params = (stmt.args as any[]) ?? [];
    }

    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith("PRAGMA TABLE_INFO")) {
      // PRAGMA returns rows with specific column names
      const tableName = sql.match(/PRAGMA\s+table_info\((\w+)\)/i)?.[1];
      if (!tableName) return makeResultSet([], []);
      const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      return makeResultSet(["cid", "name", "type", "notnull", "dflt_value", "pk"], rows);
    }

    const prepared = db.prepare(sql);

    if (trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA")) {
      const rows = (params.length > 0 ? prepared.all(...params) : prepared.all()) as Record<
        string,
        any
      >[];
      const columns =
        rows.length > 0 ? Object.keys(rows[0]) : prepared.columns().map((c) => c.name);
      return makeResultSet(columns, rows);
    } else {
      const result = params.length > 0 ? prepared.run(...params) : prepared.run();
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        rowsAffected: result.changes,
        lastInsertRowid: undefined as any,
        toJSON: () => ({}),
      };
    }
  }

  return {
    execute: async (stmt: any, args?: any[]): Promise<ResultSet> => {
      return exec(stmt, args);
    },
    batch: async (stmts: any[], _mode?: TransactionMode): Promise<ResultSet[]> => {
      return stmts.map((s: any) => exec(s));
    },
    // Stubs for unused methods
    transaction: (() => {}) as any,
    executeMultiple: (async () => {}) as any,
    migrate: (async () => {}) as any,
    sync: (async () => ({ frames_synced: 0, frame_no: 0 })) as any,
    close: () => {},
    closed: false,
    protocol: "http" as any,
    reconnect: () => {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TestDb = WrappedUserDb & { close: () => void };

function createRemoteDb(): { db: Database.Database; client: Client } {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Apply all migrations (same as local)
  for (const sql of USER_DB_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      if (err.message?.includes("duplicate column")) continue;
      throw err;
    }
  }
  return { db, client: createMockTurso(db) };
}

const noop = () => {};

async function insertList(
  db: WrappedUserDb,
  id: string,
  name: string,
  updatedAt: string,
  opts?: { isDefault?: boolean; deletedAt?: string },
) {
  await db.runAsync(
    `INSERT INTO lists (id, name, is_default, study_position, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [id, name, opts?.isDefault ? 1 : 0, updatedAt, updatedAt, opts?.deletedAt ?? null],
  );
}

async function insertListEntry(
  db: WrappedUserDb,
  id: string,
  listId: string,
  entryId: number,
  updatedAt: string,
) {
  await db.runAsync(
    `INSERT INTO list_entries (id, list_id, entry_id, added_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, listId, entryId, updatedAt, updatedAt],
  );
}

async function insertSrsCard(
  db: WrappedUserDb,
  id: string,
  listId: string,
  entryId: number,
  updatedAt: string,
) {
  await db.runAsync(
    `INSERT INTO srs_cards (id, list_id, entry_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
    [id, listId, entryId, updatedAt, updatedAt, updatedAt],
  );
}

async function insertReviewLog(
  db: WrappedUserDb,
  id: string,
  cardId: string,
  rating: number,
  reviewedAt: string,
) {
  await db.runAsync(
    `INSERT INTO review_logs (id, card_id, rating, state, due, reviewed_at, elapsed_days, scheduled_days, stability, difficulty) VALUES (?, ?, ?, 0, ?, ?, 0, 0, 0, 0)`,
    [id, cardId, rating, reviewedAt, reviewedAt],
  );
}

async function insertPracticeSession(
  db: WrappedUserDb,
  id: string,
  sessionId: string,
  listId: string,
  startedAt: string,
) {
  await db.runAsync(
    `INSERT INTO practice_sessions (id, session_id, list_id, practice_mode, started_at, duration_ms, total_items, correct_count)
     VALUES (?, ?, ?, 'flashcard', ?, 1000, 10, 8)`,
    [id, sessionId, listId, startedAt],
  );
}

function insertRemoteRow(remoteDb: Database.Database, table: string, row: Record<string, any>) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(", ");
  remoteDb
    .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`)
    .run(...cols.map((c) => row[c] ?? null));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync engine", () => {
  let local: TestDb;
  let remoteDb: Database.Database;
  let turso: Client;

  beforeEach(() => {
    local = createTestDb();
    const remote = createRemoteDb();
    remoteDb = remote.db;
    turso = remote.client;
  });

  afterEach(() => {
    local.close();
    remoteDb.close();
  });

  describe("basic push and pull", () => {
    it("pushes a local list to remote", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "list-1", "My List", now);

      const result = await sync(local, turso, noop, noop);

      expect(result.ok).toBe(true);
      expect(result.pushed).toBeGreaterThan(0);

      // Verify data arrived in remote
      const rows = remoteDb.prepare("SELECT * FROM lists WHERE id = ?").all("list-1") as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("My List");
    });

    it("pulls a remote list to local", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      insertRemoteRow(remoteDb, "lists", {
        id: "remote-list",
        name: "Remote List",
        is_default: 0,
        study_position: 0,
        created_at: now,
        updated_at: now,
      });

      const result = await sync(local, turso, noop, noop);

      expect(result.ok).toBe(true);
      expect(result.pulled).toBeGreaterThan(0);

      const row = await local.getFirstAsync<{ name: string }>(
        "SELECT name FROM lists WHERE id = ?",
        ["remote-list"],
      );
      expect(row?.name).toBe("Remote List");
    });

    it("round-trips data: push then pull on second client", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "shared-list", "Shared", now);
      await insertListEntry(local, "entry-1", "shared-list", 100, now);

      // Sync local → remote
      await sync(local, turso, noop, noop);

      // Create a second local DB (simulating another device)
      const local2 = createTestDb();
      try {
        const result = await sync(local2, turso, noop, noop);
        expect(result.ok).toBe(true);

        const list = await local2.getFirstAsync<{ name: string }>(
          "SELECT name FROM lists WHERE id = ?",
          ["shared-list"],
        );
        expect(list?.name).toBe("Shared");

        const entry = await local2.getFirstAsync<{ entry_id: number }>(
          "SELECT entry_id FROM list_entries WHERE id = ?",
          ["entry-1"],
        );
        expect(entry?.entry_id).toBe(100);
      } finally {
        local2.close();
      }
    });

    it("does not echo freshly pulled rows back to remote during the same sync", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      insertRemoteRow(remoteDb, "lists", {
        id: "remote-only-list",
        name: "Remote Only",
        is_default: 0,
        study_position: 0,
        created_at: now,
        updated_at: now,
      });
      remoteDb
        .prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('push_version', '7')")
        .run();

      const result = await sync(local, turso, noop, noop);

      expect(result.ok).toBe(true);
      expect(result.pulled).toBeGreaterThan(0);
      expect(result.pushed).toBe(0);

      const remotePushVersion = remoteDb
        .prepare("SELECT value FROM sync_meta WHERE key = 'push_version'")
        .get() as any;
      expect(remotePushVersion?.value).toBe("7");
    });
  });

  describe("LWW conflict resolution", () => {
    it("remote wins when remote timestamp is newer", async () => {
      const older = "2025-01-01T00:00:00.000Z";
      const newer = "2025-06-01T00:00:00.000Z";

      // Local has older version
      await insertList(local, "conflict-list", "Local Version", older);

      // Remote has newer version
      insertRemoteRow(remoteDb, "lists", {
        id: "conflict-list",
        name: "Remote Version",
        is_default: 0,
        study_position: 5,
        created_at: older,
        updated_at: newer,
      });

      await sync(local, turso, noop, noop);

      const row = await local.getFirstAsync<{ name: string; study_position: number }>(
        "SELECT name, study_position FROM lists WHERE id = ?",
        ["conflict-list"],
      );
      expect(row?.name).toBe("Remote Version");
      expect(row?.study_position).toBe(5);
    });

    it("local wins when local timestamp is newer", async () => {
      const older = "2025-01-01T00:00:00.000Z";
      const newer = "2025-06-01T00:00:00.000Z";

      // Local has newer version
      await insertList(local, "conflict-list", "Local Version", newer);

      // Remote has older version
      insertRemoteRow(remoteDb, "lists", {
        id: "conflict-list",
        name: "Remote Version",
        is_default: 0,
        study_position: 0,
        created_at: older,
        updated_at: older,
      });

      await sync(local, turso, noop, noop);

      // Local should keep its version
      const row = await local.getFirstAsync<{ name: string }>(
        "SELECT name FROM lists WHERE id = ?",
        ["conflict-list"],
      );
      expect(row?.name).toBe("Local Version");

      // Remote should get updated with local version
      const remoteRow = remoteDb
        .prepare("SELECT name FROM lists WHERE id = ?")
        .get("conflict-list") as any;
      expect(remoteRow?.name).toBe("Local Version");
    });
  });

  describe("push filters", () => {
    it("does not push default list entries", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      // Default list entries have list_id starting with "default-"
      await insertList(local, "default-jlpt", "JLPT N5", now, { isDefault: true });
      await insertListEntry(local, "de-1", "default-jlpt", 1, now);

      await sync(local, turso, noop, noop);

      // Default list entries should NOT be in remote
      const rows = remoteDb
        .prepare("SELECT * FROM list_entries WHERE list_id = ?")
        .all("default-jlpt") as any[];
      expect(rows).toHaveLength(0);
    });

    it("pushes non-default list entries", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "my-list", "My List", now);
      await insertListEntry(local, "ue-1", "my-list", 42, now);

      await sync(local, turso, noop, noop);

      const rows = remoteDb
        .prepare("SELECT * FROM list_entries WHERE list_id = ?")
        .all("my-list") as any[];
      expect(rows).toHaveLength(1);
    });

    it("does not push smart-review lists or their entries / srs_cards", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "_smart_my-list", "Smart Review", now);
      await insertListEntry(local, "se-1", "_smart_my-list", 99, now);
      await insertSrsCard(local, "sc-1", "_smart_my-list", 99, now);

      await sync(local, turso, noop, noop);

      expect(
        remoteDb.prepare("SELECT * FROM lists WHERE id = ?").all("_smart_my-list") as any[],
      ).toHaveLength(0);
      expect(
        remoteDb
          .prepare("SELECT * FROM list_entries WHERE list_id = ?")
          .all("_smart_my-list") as any[],
      ).toHaveLength(0);
      expect(
        remoteDb
          .prepare("SELECT * FROM srs_cards WHERE list_id = ?")
          .all("_smart_my-list") as any[],
      ).toHaveLength(0);
    });

    it("does not push marked-for-review temp lists or their rows", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "_marked_123", "Marked", now);
      await insertListEntry(local, "me-1", "_marked_123", 42, now);
      await insertSrsCard(local, "mc-1", "_marked_123", 42, now);

      await sync(local, turso, noop, noop);

      expect(
        remoteDb.prepare("SELECT * FROM lists WHERE id = ?").all("_marked_123") as any[],
      ).toHaveLength(0);
      expect(
        remoteDb
          .prepare("SELECT * FROM list_entries WHERE list_id = ?")
          .all("_marked_123") as any[],
      ).toHaveLength(0);
      expect(
        remoteDb.prepare("SELECT * FROM srs_cards WHERE list_id = ?").all("_marked_123") as any[],
      ).toHaveLength(0);
    });
  });

  describe("append-only cloud sync", () => {
    it("does not push review logs to remote anymore", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "study-list", "Study", now);
      await insertSrsCard(local, "card-1", "study-list", 1, now);
      await insertReviewLog(local, "log-1", "card-1", 3, now);

      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      const rows = remoteDb.prepare("SELECT * FROM review_logs WHERE id = ?").all("log-1") as any[];
      expect(rows).toHaveLength(0);
    });

    it("still pushes practice session summaries", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "r-list", "List", now);
      await insertPracticeSession(local, "ps-1", "session-1", "r-list", now);

      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      const row = remoteDb
        .prepare("SELECT session_id, list_id FROM practice_sessions WHERE id = ?")
        .get("ps-1") as any;
      expect(row?.session_id).toBe("session-1");
      expect(row?.list_id).toBe("r-list");
    });
  });

  describe("soft deletes", () => {
    it("syncs soft-deleted rows to remote", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";

      await insertList(local, "del-list", "To Delete", t1);
      await sync(local, turso, noop, noop);

      // Soft-delete locally — use a timestamp after the current push cursor window
      const t2 = new Date(Date.now() + 60_000).toISOString();
      await local.runAsync("UPDATE lists SET deleted_at = ?, updated_at = ? WHERE id = ?", [
        t2,
        t2,
        "del-list",
      ]);
      await sync(local, turso, noop, noop);

      // Remote should have deleted_at set
      const row = remoteDb
        .prepare("SELECT deleted_at FROM lists WHERE id = ?")
        .get("del-list") as any;
      expect(row?.deleted_at).toBe(t2);
    });

    it("pulls soft-deleted rows from remote", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";
      const t2 = "2025-06-01T00:00:00.000Z";

      // List exists locally
      await insertList(local, "rdel-list", "Will Be Deleted", t1);

      // Remote has it as deleted with newer timestamp
      insertRemoteRow(remoteDb, "lists", {
        id: "rdel-list",
        name: "Will Be Deleted",
        is_default: 0,
        study_position: 0,
        created_at: t1,
        updated_at: t2,
        deleted_at: t2,
      });

      await sync(local, turso, noop, noop);

      const row = await local.getFirstAsync<{ deleted_at: string | null }>(
        "SELECT deleted_at FROM lists WHERE id = ?",
        ["rdel-list"],
      );
      expect(row?.deleted_at).toBe(t2);
    });

    it("does not lose soft-delete when pull is skipped due to push_version race", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";

      // Device A creates a list and syncs
      await insertList(local, "race-list", "Race List", t1);
      await sync(local, turso, noop, noop);

      // Device B (second local) syncs — gets the list
      const local2 = createTestDb();
      try {
        await sync(local2, turso, noop, noop);

        // Verify Device B has the list
        const before = await local2.getFirstAsync<{ name: string }>(
          "SELECT name FROM lists WHERE id = ?",
          ["race-list"],
        );
        expect(before?.name).toBe("Race List");

        // Device A soft-deletes the list and syncs
        const t2 = new Date(Date.now() + 60_000).toISOString();
        await local.runAsync("UPDATE lists SET deleted_at = ?, updated_at = ? WHERE id = ?", [
          t2,
          t2,
          "race-list",
        ]);
        await sync(local, turso, noop, noop);

        // Device B syncs — should pick up the deletion
        await sync(local2, turso, noop, noop);

        const after = await local2.getFirstAsync<{ deleted_at: string | null }>(
          "SELECT deleted_at FROM lists WHERE id = ?",
          ["race-list"],
        );
        expect(after?.deleted_at).toBe(t2);
      } finally {
        local2.close();
      }
    });
  });

  describe("version-based pull optimization", () => {
    it("skips pull when remote version unchanged", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "v-list", "Versioned", now);

      // First sync — pushes and sets versions
      await sync(local, turso, noop, noop);

      // Insert new data in remote without incrementing push_version
      insertRemoteRow(remoteDb, "lists", {
        id: "sneaky-list",
        name: "Sneaky",
        is_default: 0,
        study_position: 0,
        created_at: "2025-06-01T00:00:00.000Z",
        updated_at: "2025-06-01T00:00:00.000Z",
      });

      // Second sync — should skip pull because version unchanged
      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      // sneaky-list should NOT be pulled (version hasn't changed)
      const row = await local.getFirstAsync<any>("SELECT * FROM lists WHERE id = ?", [
        "sneaky-list",
      ]);
      expect(row).toBeNull();
    });

    it("pulls when remote version changes", async () => {
      // First sync to establish baseline
      await sync(local, turso, noop, noop);

      // Add data to remote with a timestamp after the initial pull window and increment push_version
      const future = new Date(Date.now() + 60_000).toISOString();
      insertRemoteRow(remoteDb, "lists", {
        id: "new-remote",
        name: "New Remote",
        is_default: 0,
        study_position: 0,
        created_at: future,
        updated_at: future,
      });
      remoteDb
        .prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('push_version', '999')")
        .run();

      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      const row = await local.getFirstAsync<{ name: string }>(
        "SELECT name FROM lists WHERE id = ?",
        ["new-remote"],
      );
      expect(row?.name).toBe("New Remote");
    });
  });

  describe("column exclusion", () => {
    it("excludes html_content from push (no blob config) but syncs raw_content via blob sync", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await local.runAsync(
        `INSERT INTO books (id, title, is_default, html_content, raw_content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)`,
        ["book-1", "My Book", "<h1>Content</h1>", "Raw content here", now, now],
      );

      await sync(local, turso, noop, noop);

      const row = remoteDb
        .prepare("SELECT title, html_content, raw_content FROM books WHERE id = ?")
        .get("book-1") as any;
      expect(row?.title).toBe("My Book");
      // html_content is excluded and has no blob config — stays null
      expect(row?.html_content).toBeNull();
      // raw_content is excluded from regular push but synced via blobCols
      expect(row?.raw_content).toBe("Raw content here");
    });
  });

  describe("blob column sync", () => {
    it("pushes blob content when remote is missing it", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      // Insert a non-default book with raw_content locally
      await local.runAsync(
        `INSERT INTO books (id, title, is_default, raw_content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)`,
        ["blob-book", "Blob Book", "The full raw content", now, now],
      );

      // Sync — regular push creates book row (without raw_content), then blob sync pushes raw_content
      await sync(local, turso, noop, noop);

      const row = remoteDb
        .prepare("SELECT raw_content FROM books WHERE id = ?")
        .get("blob-book") as any;
      expect(row?.raw_content).toBe("The full raw content");
    });

    it("pulls blob content when local is missing it", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      // Book exists both locally and remotely, but local is missing raw_content
      await local.runAsync(
        `INSERT INTO books (id, title, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
        ["pull-blob", "Pull Book", now, now],
      );
      insertRemoteRow(remoteDb, "books", {
        id: "pull-blob",
        title: "Pull Book",
        is_default: 0,
        raw_content: "Content from remote",
        created_at: now,
        updated_at: now,
      });

      await sync(local, turso, noop, noop);

      const row = await local.getFirstAsync<{ raw_content: string }>(
        "SELECT raw_content FROM books WHERE id = ?",
        ["pull-blob"],
      );
      expect(row?.raw_content).toBe("Content from remote");
    });

    it("does not sync blobs for default books (filter: is_default = 0)", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      // Default book with raw_content locally
      await local.runAsync(
        `INSERT INTO books (id, title, is_default, raw_content, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)`,
        ["default-book", "Default", "Default content", now, now],
      );

      await sync(local, turso, noop, noop);

      // Default book's raw_content should NOT be pushed
      const row = remoteDb
        .prepare("SELECT raw_content FROM books WHERE id = ?")
        .get("default-book") as any;
      // Row might not even exist or raw_content should be null
      expect(row?.raw_content ?? null).toBeNull();
    });
  });

  describe("ON CONFLICT preserves local-only columns", () => {
    it("pull does not overwrite local raw_content", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";
      const t2 = "2025-06-01T00:00:00.000Z";

      // Local book has raw_content
      await local.runAsync(
        `INSERT INTO books (id, title, is_default, raw_content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)`,
        ["preserve-book", "Book", "Local content", t1, t1],
      );

      // Remote has newer metadata but no raw_content (since it's excluded from push)
      insertRemoteRow(remoteDb, "books", {
        id: "preserve-book",
        title: "Updated Title",
        is_default: 0,
        created_at: t1,
        updated_at: t2,
      });

      await sync(local, turso, noop, noop);

      const row = await local.getFirstAsync<{ title: string; raw_content: string | null }>(
        "SELECT title, raw_content FROM books WHERE id = ?",
        ["preserve-book"],
      );
      // Title should be updated from remote
      expect(row?.title).toBe("Updated Title");
      // raw_content should be preserved (not overwritten by NULL from excluded column)
      expect(row?.raw_content).toBe("Local content");
    });
  });

  describe("chunked PK lookups", () => {
    it("handles pulls with more than 500 rows", async () => {
      const now = "2025-01-01T00:00:00.000Z";

      // Insert 600 SRS cards into remote to exceed the 500-PK chunk size
      const listId = "bulk-list";
      insertRemoteRow(remoteDb, "lists", {
        id: listId,
        name: "Bulk",
        is_default: 0,
        study_position: 0,
        created_at: now,
        updated_at: now,
      });
      for (let i = 0; i < 600; i++) {
        insertRemoteRow(remoteDb, "srs_cards", {
          id: `card-${i}`,
          list_id: listId,
          entry_id: i,
          due: now,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: 0,
          lapses: 0,
          state: 0,
          created_at: now,
          updated_at: now,
        });
      }

      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      // All 600 should be pulled
      const count = await local.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) as n FROM srs_cards WHERE list_id = ?",
        [listId],
      );
      expect(count?.n).toBe(600);
    });
  });

  describe("error handling", () => {
    it("returns error result on Turso failure", async () => {
      const failingTurso: Client = {
        execute: async () => {
          throw new Error("Connection refused");
        },
        batch: async () => {
          throw new Error("Connection refused");
        },
        transaction: (() => {}) as any,
        executeMultiple: (async () => {}) as any,
        migrate: (async () => {}) as any,
        sync: (async () => ({ frames_synced: 0, frame_no: 0 })) as any,
        close: () => {},
        closed: false,
        protocol: "http" as any,
        reconnect: () => {},
      };

      const result = await sync(local, failingTurso, noop, noop);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Connection refused");
    });
  });

  describe("isNetworkError", () => {
    it("detects common network error patterns", () => {
      expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
      expect(isNetworkError(new Error("NetworkError when attempting"))).toBe(true);
      expect(isNetworkError(new Error("net::ERR_FAILED"))).toBe(true);
      expect(isNetworkError(new Error("Load failed"))).toBe(true);
      expect(isNetworkError(new Error("Network request failed"))).toBe(true);
      expect(isNetworkError("CORS error")).toBe(true);
    });

    it("does not flag non-network errors", () => {
      expect(isNetworkError(new Error("UNIQUE constraint failed"))).toBe(false);
      expect(isNetworkError(new Error("table not found"))).toBe(false);
      expect(isNetworkError("some random error")).toBe(false);
    });
  });

  describe("sync meta tracking", () => {
    it("saves independent sync cursors after successful sync", async () => {
      const result = await sync(local, turso, noop, noop);
      expect(result.ok).toBe(true);

      const pulledMeta = await local.getFirstAsync<{ value: string }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        ["last_pulled_at"],
      );
      const pushedMeta = await local.getFirstAsync<{ value: string }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        ["last_pushed_at"],
      );
      const completedMeta = await local.getFirstAsync<{ value: string }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        ["last_sync_completed_at"],
      );
      expect(pulledMeta?.value).toBeTruthy();
      expect(pushedMeta?.value).toBeTruthy();
      expect(completedMeta?.value).toBeTruthy();
      expect(new Date(pulledMeta!.value).getTime()).toBeGreaterThan(0);
      expect(new Date(pushedMeta!.value).getTime()).toBeGreaterThan(0);
      expect(new Date(completedMeta!.value).getTime()).toBeGreaterThan(0);
    });

    it("increments push_version on remote after push", async () => {
      const now = "2025-01-01T00:00:00.000Z";
      await insertList(local, "pv-list", "PV", now);

      await sync(local, turso, noop, noop);

      const row = remoteDb
        .prepare("SELECT value FROM sync_meta WHERE key = 'push_version'")
        .get() as any;
      expect(Number(row?.value)).toBeGreaterThan(0);
    });

    it("saves remote schema version after initial sync", async () => {
      await sync(local, turso, noop, noop);

      const meta = await local.getFirstAsync<{ value: string }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        ["remote_schema_version"],
      );
      expect(meta?.value).toBeTruthy();
      expect(Number(meta!.value)).toBe(USER_DB_MIGRATIONS.length - 1);
    });
  });

  describe("multiple syncs", () => {
    it("incremental sync only pushes new changes", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";

      await insertList(local, "inc-1", "First", t1);
      const r1 = await sync(local, turso, noop, noop);
      expect(r1.ok).toBe(true);
      const firstPush = r1.pushed;

      // Add another list after first sync — use future timestamp so it's after last_pushed_at
      const t2 = new Date(Date.now() + 60_000).toISOString();
      await insertList(local, "inc-2", "Second", t2);
      const r2 = await sync(local, turso, noop, noop);
      expect(r2.ok).toBe(true);
      // Should push fewer statements (only the new list, not the first one again)
      expect(r2.pushed).toBeLessThan(firstPush + 5);

      // Both should exist in remote
      const count = remoteDb
        .prepare("SELECT COUNT(*) as n FROM lists WHERE id IN ('inc-1','inc-2')")
        .get() as any;
      expect(count.n).toBe(2);
    });

    it("does not repush already-synced rows when pull is skipped", async () => {
      const t1 = "2025-01-01T00:00:00.000Z";

      await insertList(local, "stable-1", "Stable", t1);
      const first = await sync(local, turso, noop, noop);
      expect(first.ok).toBe(true);

      const second = await sync(local, turso, noop, noop);
      expect(second.ok).toBe(true);
      expect(second.pushed).toBe(0);

      const t2 = new Date(Date.now() + 60_000).toISOString();
      await insertList(local, "stable-2", "Fresh", t2);
      const third = await sync(local, turso, noop, noop);
      expect(third.ok).toBe(true);
      expect(third.pushed).toBeGreaterThan(0);

      const rows = remoteDb
        .prepare("SELECT id, name FROM lists WHERE id IN ('stable-1', 'stable-2') ORDER BY id")
        .all() as any[];
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe("stable-1");
      expect(rows[1].id).toBe("stable-2");
    });
  });
});
