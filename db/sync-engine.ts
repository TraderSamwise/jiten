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

/** Returns true if new migrations were applied (schema changed). */
async function ensureRemoteSchema(localDb: WrappedUserDb, turso: Client): Promise<boolean> {
  const stored = await getSyncMeta(localDb, "remote_schema_version");
  const appliedVersion = stored ? parseInt(stored, 10) : -1;
  const total = USER_DB_MIGRATIONS.length;

  if (appliedVersion >= total - 1) return false;

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
  // Invalidate persisted column cache since schema changed
  columnCache.clear();
  await setSyncMeta(localDb, "columns_cache", "");
  return true;
}

// ---------------------------------------------------------------------------
// Column discovery — cached across sync cycles, batched on first use
// ---------------------------------------------------------------------------

const columnCache = new Map<string, string[]>();

async function ensureColumnCache(turso: Client, localDb: WrappedUserDb): Promise<void> {
  // Try restoring from persisted cache first
  if (columnCache.size === 0) {
    const cached = await getSyncMeta(localDb, "columns_cache");
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, string[]>;
      for (const [table, cols] of Object.entries(parsed)) {
        columnCache.set(table, cols);
      }
    }
  }

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

  // Persist for future sessions
  await setSyncMeta(localDb, "columns_cache", JSON.stringify(Object.fromEntries(columnCache)));
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

    if (meta.mutable) {
      // Batch fetch all local timestamps for LWW comparison (fixes N+1)
      const pks = rows.map((r: any) => r[meta.pk] ?? r[meta.cols.indexOf(meta.pk)]);
      const localRows = await localDb.getAllAsync<Record<string, any>>(
        `SELECT ${meta.pk} AS _pk, ${meta.timestampCol} AS _ts FROM ${meta.name} WHERE ${meta.pk} IN (${pks.map(() => "?").join(",")})`,
        pks,
      );
      const localTimestamps = new Map(localRows.map((r) => [String(r._pk), String(r._ts ?? "")]));

      for (const row of rows) {
        const pkVal = String(row[meta.pk] ?? row[meta.cols.indexOf(meta.pk)]);
        const remoteTs = String(
          row[meta.timestampCol] ?? row[meta.cols.indexOf(meta.timestampCol)] ?? "",
        );
        const localTs = localTimestamps.get(pkVal);
        if (localTs && localTs >= remoteTs) continue;

        const values = meta.cols.map((c) => {
          const v = row[c] ?? row[meta.cols.indexOf(c)];
          return v === undefined ? null : v;
        });
        await localDb.runAsync(
          `INSERT OR REPLACE INTO ${meta.name} (${colList}) VALUES (${placeholders})`,
          values,
        );
        pulled++;
      }
    } else {
      // Append-only: INSERT OR IGNORE
      for (const row of rows) {
        const values = meta.cols.map((c) => {
          const v = row[c] ?? row[meta.cols.indexOf(c)];
          return v === undefined ? null : v;
        });
        try {
          await localDb.runAsync(
            `INSERT OR IGNORE INTO ${meta.name} (${colList}) VALUES (${placeholders})`,
            values,
          );
        } catch {
          // ignore
        }
        pulled++;
      }
    }
  }
  return pulled;
}

// ---------------------------------------------------------------------------
// Push: local → remote (batched per table)
// ---------------------------------------------------------------------------

async function pushAll(
  localDb: WrappedUserDb,
  turso: Client,
  lastSyncAt: string,
  onProgress?: (progress: number) => void,
): Promise<number> {
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
    console.log(`[Sync] push ${table.name}: ${rows.length} rows`);
    // Use ON CONFLICT DO UPDATE instead of INSERT OR REPLACE to avoid
    // DELETE+INSERT cycle which triggers FK cascade violations.
    const updateCols = cols.filter((c) => c !== table.pk);
    const updateSet = updateCols.map((c) => `${c}=excluded.${c}`).join(", ");
    for (const row of rows) {
      allStmts.push({
        sql: `INSERT INTO ${table.name} (${colList}) VALUES (${placeholders}) ON CONFLICT(${table.pk}) DO UPDATE SET ${updateSet}`,
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
    console.log(`[Sync] push ${table.name}: ${rows.length} rows`);
    for (const row of rows) {
      allStmts.push({
        sql: `INSERT OR IGNORE INTO ${table.name} (${colList}) VALUES (${placeholders})`,
        args: cols.map((c) => row[c] ?? null),
      });
    }
  }

  if (allStmts.length === 0) return 0;

  console.log(`[Sync] pushing ${allStmts.length} statements`);

  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(allStmts.length / CHUNK_SIZE);
  for (let i = 0; i < allStmts.length; i += CHUNK_SIZE) {
    const chunk = allStmts.slice(i, i + CHUNK_SIZE);
    await turso.batch(chunk, "write");
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    console.log(`[Sync] pushed chunk ${chunkNum}/${totalChunks} (${chunk.length} stmts)`);
    onProgress?.(chunkNum / totalChunks);
  }
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
    const t0 = Date.now();

    // 1. Ensure remote schema (skips if version matches)
    const schemaChanged = await ensureRemoteSchema(localDb, turso);
    console.log(`[Sync] schema: ${Date.now() - t0}ms (changed=${schemaChanged})`);
    onProgress?.(0.05);

    // 2. Ensure column cache (persisted locally, fetched from remote only when needed)
    await ensureColumnCache(turso, localDb);
    console.log(`[Sync] columns: ${Date.now() - t0}ms`);
    onProgress?.(0.1);

    // 3. Get last sync timestamp
    const lastSyncAt = (await getSyncMeta(localDb, "last_sync_at")) ?? "1970-01-01T00:00:00.000Z";
    console.log(`[Sync] lastSyncAt=${lastSyncAt}`);

    // 4. Check remote push_version — skip pull if nothing changed remotely
    let pulled = 0;
    const remotePushVersion = await turso.execute(
      "SELECT value FROM sync_meta WHERE key = 'push_version'",
    );
    const remoteVersion =
      remotePushVersion.rows.length > 0
        ? String(remotePushVersion.rows[0].value ?? remotePushVersion.rows[0][1])
        : null;
    const localVersion = await getSyncMeta(localDb, "last_seen_push_version");
    const skipPull = !schemaChanged && remoteVersion !== null && remoteVersion === localVersion;
    console.log(
      `[Sync] version check: ${Date.now() - t0}ms (remote=${remoteVersion}, local=${localVersion}, skipPull=${skipPull})`,
    );

    if (skipPull) {
      console.log("[Sync] Remote version unchanged, skipping pull");
    } else {
      // 5. Pull (single batch request for all tables)
      pulled = await pullAll(localDb, turso, lastSyncAt);
      console.log(`[Sync] pull: ${Date.now() - t0}ms (${pulled} rows)`);
    }
    onProgress?.(0.5);

    // 6. Push — progress 0.5→1.0 proportional to chunks
    const pushed = await pushAll(localDb, turso, lastSyncAt, (p) => onProgress?.(0.5 + p * 0.5));
    onProgress?.(1);
    console.log(`[Sync] push: ${Date.now() - t0}ms (${pushed} stmts)`);

    // 7. If pushed, increment remote push_version
    if (pushed > 0) {
      await turso.execute(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('push_version', CAST(COALESCE((SELECT value FROM sync_meta WHERE key = 'push_version'), '0') AS INTEGER) + 1)",
      );
      const newVersionResult = await turso.execute(
        "SELECT value FROM sync_meta WHERE key = 'push_version'",
      );
      const newVersion = String(newVersionResult.rows[0].value ?? newVersionResult.rows[0][1]);
      await setSyncMeta(localDb, "last_seen_push_version", newVersion);
    } else if (remoteVersion !== null) {
      // No push, but save remote version locally so next sync can skip pull
      await setSyncMeta(localDb, "last_seen_push_version", remoteVersion);
    }

    // 8. Update last sync timestamp
    await setSyncMeta(localDb, "last_sync_at", new Date().toISOString());

    console.log(`[Sync] Complete: ${Date.now() - t0}ms total — pulled ${pulled}, pushed ${pushed}`);
    return { ok: true, pulled, pushed };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Error:", errorMsg);
    return { ok: false, error: errorMsg, pulled: 0, pushed: 0 };
  }
}
