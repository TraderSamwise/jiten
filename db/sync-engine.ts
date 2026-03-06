import type { Client } from "@libsql/client/web";
import type { WrappedUserDb } from "./user-db";
import { MUTABLE_TABLES, APPEND_TABLES } from "./sync-helpers";
import { USER_DB_MIGRATIONS } from "./user-migrations";

export interface SyncResult {
  ok: boolean;
  error?: string;
  pulled: number;
  pushed: number;
}

// ---------------------------------------------------------------------------
// Sync meta helpers
// ---------------------------------------------------------------------------

async function getSyncMeta(db: WrappedUserDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

async function setSyncMeta(db: WrappedUserDb, key: string, value: string): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)", [key, value]);
}

// ---------------------------------------------------------------------------
// Remote schema initialization (versioned — only runs new migrations)
// ---------------------------------------------------------------------------

async function ensureRemoteSchema(localDb: WrappedUserDb, turso: Client): Promise<void> {
  const stored = await getSyncMeta(localDb, "remote_schema_version");
  const appliedVersion = stored ? parseInt(stored, 10) : -1;
  const total = USER_DB_MIGRATIONS.length;

  if (appliedVersion >= total - 1) return;

  const pending = USER_DB_MIGRATIONS.slice(appliedVersion + 1);
  console.log(
    `[Sync] Applying ${pending.length} remote migrations (${appliedVersion + 1}→${total - 1})`,
  );

  // Try batch first (single request)
  try {
    await turso.batch(
      pending.map((sql) => ({ sql })),
      "write",
    );
  } catch (err) {
    // Batch may fail if some migrations conflict — fall back to individual
    for (const sql of pending) {
      try {
        await turso.execute(sql);
      } catch (e) {
        const m = String(e);
        if (!m.includes("duplicate column") && !m.includes("already exists")) {
          console.warn("[Sync] Remote migration warning:", m);
        }
      }
    }
  }

  await setSyncMeta(localDb, "remote_schema_version", String(total - 1));
}

// ---------------------------------------------------------------------------
// Column discovery — cached across sync cycles, batched on first use
// ---------------------------------------------------------------------------

const columnCache = new Map<string, string[]>();

async function ensureColumnCache(turso: Client): Promise<void> {
  const allTables = [...MUTABLE_TABLES.map((t) => t.name), ...APPEND_TABLES.map((t) => t.name)];
  const uncached = allTables.filter((t) => !columnCache.has(t));
  if (uncached.length === 0) return;

  // Single batch request for all PRAGMA calls
  const results = await turso.batch(
    uncached.map((t) => ({ sql: `PRAGMA table_info(${t})` })),
    "read",
  );

  for (let i = 0; i < uncached.length; i++) {
    const cols = results[i].rows.map((r: any) => String(r.name ?? r[1]));
    columnCache.set(uncached[i], cols);
  }
}

function getColumns(table: string, exclude?: readonly string[]): string[] {
  const cols = columnCache.get(table) ?? [];
  if (!exclude || exclude.length === 0) return cols;
  const excludeSet = new Set(exclude);
  return cols.filter((c) => !excludeSet.has(c));
}

// ---------------------------------------------------------------------------
// Pull: remote → local (batched SELECTs)
// ---------------------------------------------------------------------------

async function pullAll(localDb: WrappedUserDb, turso: Client, lastSyncAt: string): Promise<number> {
  // Build all pull queries in one batch
  const queries: { sql: string; args: any[] }[] = [];
  const queryMeta: {
    name: string;
    pk: string;
    timestampCol: string;
    cols: string[];
    mutable: boolean;
  }[] = [];

  for (const table of MUTABLE_TABLES) {
    const excludeCols = "excludeCols" in table ? table.excludeCols : undefined;
    const cols = getColumns(table.name, excludeCols);
    if (cols.length === 0) continue;
    queries.push({
      sql: `SELECT ${cols.join(", ")} FROM ${table.name} WHERE ${table.timestampCol} > ?`,
      args: [lastSyncAt],
    });
    queryMeta.push({ ...table, cols, mutable: true });
  }
  for (const table of APPEND_TABLES) {
    const cols = getColumns(table.name);
    if (cols.length === 0) continue;
    queries.push({
      sql: `SELECT ${cols.join(", ")} FROM ${table.name} WHERE ${table.timestampCol} > ?`,
      args: [lastSyncAt],
    });
    queryMeta.push({ ...table, cols, mutable: false });
  }

  if (queries.length === 0) return 0;

  // Single batch request for all pull SELECTs
  const results = await turso.batch(queries, "read");

  let pulled = 0;
  for (let i = 0; i < results.length; i++) {
    const { rows } = results[i];
    if (rows.length === 0) continue;

    const meta = queryMeta[i];
    const colList = meta.cols.join(", ");
    const placeholders = meta.cols.map(() => "?").join(", ");

    for (const row of rows) {
      const values = meta.cols.map((c) => {
        const v = row[c] ?? row[meta.cols.indexOf(c)];
        return v === undefined ? null : v;
      });

      if (meta.mutable) {
        // Last-write-wins: check if local is newer
        const pkVal = row[meta.pk] ?? row[meta.cols.indexOf(meta.pk)];
        const remoteTs = String(
          row[meta.timestampCol] ?? row[meta.cols.indexOf(meta.timestampCol)] ?? "",
        );
        const localRow = await localDb.getFirstAsync<Record<string, any>>(
          `SELECT ${meta.timestampCol} FROM ${meta.name} WHERE ${meta.pk} = ?`,
          [pkVal],
        );
        if (localRow && String(localRow[meta.timestampCol] ?? "") >= remoteTs) {
          continue;
        }
        await localDb.runAsync(
          `INSERT OR REPLACE INTO ${meta.name} (${colList}) VALUES (${placeholders})`,
          values,
        );
      } else {
        // Append-only: INSERT OR IGNORE
        try {
          await localDb.runAsync(
            `INSERT OR IGNORE INTO ${meta.name} (${colList}) VALUES (${placeholders})`,
            values,
          );
        } catch {
          // ignore
        }
      }
      pulled++;
    }
  }
  return pulled;
}

// ---------------------------------------------------------------------------
// Push: local → remote (batched per table)
// ---------------------------------------------------------------------------

async function pushAll(localDb: WrappedUserDb, turso: Client, lastSyncAt: string): Promise<number> {
  const allStmts: { sql: string; args: any[] }[] = [];

  for (const table of MUTABLE_TABLES) {
    const excludeCols = "excludeCols" in table ? table.excludeCols : undefined;
    const cols = getColumns(table.name, excludeCols);
    if (cols.length === 0) continue;
    const colList = cols.join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const rows = await localDb.getAllAsync<Record<string, any>>(
      `SELECT ${colList} FROM ${table.name} WHERE ${table.timestampCol} > ?`,
      [lastSyncAt],
    );
    for (const row of rows) {
      allStmts.push({
        sql: `INSERT OR REPLACE INTO ${table.name} (${colList}) VALUES (${placeholders})`,
        args: cols.map((c) => row[c] ?? null),
      });
    }
  }

  for (const table of APPEND_TABLES) {
    const cols = getColumns(table.name);
    if (cols.length === 0) continue;
    const colList = cols.join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const rows = await localDb.getAllAsync<Record<string, any>>(
      `SELECT ${colList} FROM ${table.name} WHERE ${table.timestampCol} > ?`,
      [lastSyncAt],
    );
    for (const row of rows) {
      allStmts.push({
        sql: `INSERT OR IGNORE INTO ${table.name} (${colList}) VALUES (${placeholders})`,
        args: cols.map((c) => row[c] ?? null),
      });
    }
  }

  if (allStmts.length === 0) return 0;

  // Single batch request for all push statements
  await turso.batch(allStmts, "write");
  return allStmts.length;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function sync(
  localDb: WrappedUserDb,
  turso: Client,
  onProgress?: (progress: number) => void,
): Promise<SyncResult> {
  try {
    onProgress?.(0);

    // 1. Ensure remote schema (skips if version matches)
    await ensureRemoteSchema(localDb, turso);
    onProgress?.(0.2);

    // 2. Ensure column cache (single batch PRAGMA, cached forever)
    await ensureColumnCache(turso);
    onProgress?.(0.35);

    // 3. Get last sync timestamp
    const lastSyncAt = (await getSyncMeta(localDb, "last_sync_at")) ?? "1970-01-01T00:00:00.000Z";

    // 4. Pull (single batch request for all tables)
    const pulled = await pullAll(localDb, turso, lastSyncAt);
    onProgress?.(0.65);

    // 5. Push (single batch request for all rows)
    const pushed = await pushAll(localDb, turso, lastSyncAt);
    onProgress?.(1);

    // 6. Update last sync timestamp
    await setSyncMeta(localDb, "last_sync_at", new Date().toISOString());

    console.log(`[Sync] Complete: pulled ${pulled}, pushed ${pushed}`);
    return { ok: true, pulled, pushed };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Error:", errorMsg);
    return { ok: false, error: errorMsg, pulled: 0, pushed: 0 };
  }
}
