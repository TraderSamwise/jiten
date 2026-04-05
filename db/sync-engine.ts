import type { Client } from "@libsql/client/web";
import type { WrappedUserDb } from "./user-db";
import { MUTABLE_TABLES, APPEND_TABLES } from "./sync-helpers";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import { captureException } from "@/lib/sentry";

export interface SyncResult {
  ok: boolean;
  error?: string;
  pulled: number;
  pushed: number;
}

const EPOCH = "1970-01-01T00:00:00.000Z";
const LAST_PULLED_AT_KEY = "last_pulled_at";
const LAST_PUSHED_AT_KEY = "last_pushed_at";
const LAST_SYNC_COMPLETED_AT_KEY = "last_sync_completed_at";
const LAST_SEEN_PUSH_VERSION_KEY = "last_seen_push_version";

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

/**
 * Filter migrations for remote DB: skip app-level indexes (only keep _updated
 * indexes needed for delta sync) and skip data mutations (UPDATE/DELETE) that
 * are only relevant locally (e.g. seed data fixups).
 */
function isRemoteRelevant(sql: string): boolean {
  const t = sql.trim().toUpperCase();
  if (t.startsWith("CREATE INDEX") || t.startsWith("CREATE UNIQUE INDEX"))
    return sql.includes("_updated");
  if (t.startsWith("UPDATE ") || t.startsWith("DELETE ")) return false;
  return true;
}

/** Returns true if new migrations were applied (schema changed). */
async function ensureRemoteSchema(localDb: WrappedUserDb, turso: Client): Promise<boolean> {
  const stored = await getSyncMeta(localDb, "remote_schema_version");
  const appliedVersion = stored ? parseInt(stored, 10) : -1;
  const total = USER_DB_MIGRATIONS.length;

  if (appliedVersion >= total - 1) return false;

  const pending = USER_DB_MIGRATIONS.slice(appliedVersion + 1);
  // Filter out non-essential indexes and data mutations for remote
  const remotePending = pending.filter(isRemoteRelevant);
  console.log(
    `[Sync] Applying ${remotePending.length}/${pending.length} remote migrations (${appliedVersion + 1}→${total - 1})`,
  );

  if (remotePending.length > 0) {
    // Try batch first (single request)
    try {
      await turso.batch(
        remotePending.map((sql) => ({ sql })),
        "write",
      );
    } catch (err) {
      // Batch may fail if some migrations conflict — fall back to individual
      for (const sql of remotePending) {
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
  }

  // Version counter advances over full array even though some are filtered
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

async function pullAll(
  localDb: WrappedUserDb,
  turso: Client,
  lastSyncAt: string,
  onProgress?: (progress: number) => void,
): Promise<number> {
  // Build per-table pull metadata
  const tableMeta: {
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
    tableMeta.push({ ...table, cols, mutable: true });
  }
  for (const table of APPEND_TABLES) {
    const cols = getColumns(table.name);
    if (cols.length === 0) continue;
    tableMeta.push({ ...table, cols, mutable: false });
  }

  if (tableMeta.length === 0) return 0;

  let pulled = 0;
  for (let ti = 0; ti < tableMeta.length; ti++) {
    const meta = tableMeta[ti];
    const colList = meta.cols.join(", ");
    const placeholders = meta.cols.map(() => "?").join(", ");

    const result = await turso.execute({
      sql: `SELECT ${colList} FROM ${meta.name} WHERE ${meta.timestampCol} > ?`,
      args: [lastSyncAt],
    });
    const { rows } = result;
    onProgress?.((ti + 1) / tableMeta.length);

    if (rows.length === 0) continue;
    console.log(`[Sync] pull ${meta.name}: ${rows.length} rows`);

    // Wrap all inserts for this table in a transaction for performance
    await localDb.runAsync("BEGIN");
    try {
      if (meta.mutable) {
        // Batch fetch local timestamps for LWW comparison (chunked to stay under SQLite param limit)
        const PK_CHUNK = 500;
        const pks = rows.map((r: any) => r[meta.pk] ?? r[meta.cols.indexOf(meta.pk)]);
        const localTimestamps = new Map<string, string>();
        for (let ci = 0; ci < pks.length; ci += PK_CHUNK) {
          const chunk = pks.slice(ci, ci + PK_CHUNK);
          const localRows = await localDb.getAllAsync<Record<string, any>>(
            `SELECT ${meta.pk} AS _pk, ${meta.timestampCol} AS _ts FROM ${meta.name} WHERE ${meta.pk} IN (${chunk.map(() => "?").join(",")})`,
            chunk,
          );
          for (const r of localRows) {
            localTimestamps.set(String(r._pk), String(r._ts ?? ""));
          }
        }

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
          // Use ON CONFLICT DO UPDATE to preserve local-only columns (e.g. raw_content)
          const updateCols = meta.cols.filter((c) => c !== meta.pk);
          const updateSet = updateCols.map((c) => `${c}=excluded.${c}`).join(", ");
          await localDb.runAsync(
            `INSERT INTO ${meta.name} (${colList}) VALUES (${placeholders}) ON CONFLICT(${meta.pk}) DO UPDATE SET ${updateSet}`,
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
      await localDb.runAsync("COMMIT");
    } catch (err) {
      await localDb.runAsync("ROLLBACK").catch(() => {});
      throw err;
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
    const filter = "pushFilter" in table ? ` AND ${table.pushFilter}` : "";
    const rows = await localDb.getAllAsync<Record<string, any>>(
      `SELECT ${colList} FROM ${table.name} WHERE ${table.timestampCol} > ?${filter}`,
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
    // Append push_version increment to the last chunk so data + version are atomic
    if (i + CHUNK_SIZE >= allStmts.length) {
      chunk.push({
        sql: "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('push_version', CAST(COALESCE((SELECT value FROM sync_meta WHERE key = 'push_version'), '0') AS INTEGER) + 1)",
        args: [],
      });
    }
    await turso.batch(chunk, "write");
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    console.log(`[Sync] pushed chunk ${chunkNum}/${totalChunks} (${chunk.length} stmts)`);
    onProgress?.(chunkNum / totalChunks);
  }
  return allStmts.length;
}

// ---------------------------------------------------------------------------
// Blob column sync — large columns excluded from regular delta sync.
// Synced once: pushed when remote is missing, pulled when local is missing.
// Configured via `blobCols` on MUTABLE_TABLES entries.
// ---------------------------------------------------------------------------

async function syncBlobColumns(localDb: WrappedUserDb, turso: Client): Promise<number> {
  let synced = 0;
  const PK_CHUNK = 500;

  for (const table of MUTABLE_TABLES) {
    if (!("blobCols" in table)) continue;
    const { cols, filter } = table.blobCols as { cols: readonly string[]; filter?: string };
    const pk = table.pk;
    const where = filter ? `AND ${filter}` : "";

    for (const col of cols) {
      // Push: local has content, check if remote is missing
      const localRows = await localDb.getAllAsync<Record<string, any>>(
        `SELECT ${pk}, ${col} FROM ${table.name} WHERE ${col} IS NOT NULL ${where} AND deleted_at IS NULL`,
      );
      if (localRows.length > 0) {
        const ids = localRows.map((r) => r[pk]);
        const remoteHas = new Set<string>();
        for (let i = 0; i < ids.length; i += PK_CHUNK) {
          const chunk = ids.slice(i, i + PK_CHUNK);
          const result = await turso.execute({
            sql: `SELECT ${pk} FROM ${table.name} WHERE ${pk} IN (${chunk.map(() => "?").join(",")}) AND ${col} IS NOT NULL`,
            args: chunk,
          });
          for (const row of result.rows) {
            remoteHas.add(String(row[pk] ?? row[0]));
          }
        }
        for (const row of localRows) {
          const id = String(row[pk]);
          if (!remoteHas.has(id)) {
            console.log(`[Sync] pushing blob ${table.name}.${col}: ${id}`);
            await turso.execute({
              sql: `UPDATE ${table.name} SET ${col} = ? WHERE ${pk} = ?`,
              args: [row[col], id],
            });
            synced++;
          }
        }
      }

      // Pull: local is missing content, fetch from remote
      const missingLocal = await localDb.getAllAsync<Record<string, any>>(
        `SELECT ${pk} FROM ${table.name} WHERE ${col} IS NULL ${where} AND deleted_at IS NULL`,
      );
      for (const row of missingLocal) {
        const id = row[pk];
        const result = await turso.execute({
          sql: `SELECT ${col} FROM ${table.name} WHERE ${pk} = ? AND ${col} IS NOT NULL`,
          args: [id],
        });
        if (result.rows.length > 0) {
          const val = result.rows[0][col] ?? result.rows[0][0];
          if (val) {
            console.log(`[Sync] pulling blob ${table.name}.${col}: ${id}`);
            await localDb.runAsync(`UPDATE ${table.name} SET ${col} = ? WHERE ${pk} = ?`, [
              val,
              id,
            ]);
            synced++;
          }
        }
      }
    }
  }

  return synced;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export function isNetworkError(err: unknown): boolean {
  const msg = String(err);
  return /Failed to fetch|NetworkError|ERR_FAILED|net::ERR_|CORS|Load failed|Network request failed/i.test(
    msg,
  );
}

export async function sync(
  localDb: WrappedUserDb,
  turso: Client,
  onProgress?: (progress: number) => void,
  onLabel?: (label: string) => void,
): Promise<SyncResult> {
  try {
    onProgress?.(0);
    onLabel?.("Preparing...");
    const t0 = Date.now();

    // 1. Ensure remote schema (skips if version matches)
    const schemaChanged = await ensureRemoteSchema(localDb, turso);
    console.log(`[Sync] schema: ${Date.now() - t0}ms (changed=${schemaChanged})`);
    onProgress?.(0.05);

    // 2. Ensure column cache (persisted locally, fetched from remote only when needed)
    await ensureColumnCache(turso, localDb);
    console.log(`[Sync] columns: ${Date.now() - t0}ms`);
    onProgress?.(0.1);

    // 3. Get independent pull/push cursors
    const lastPulledAt = (await getSyncMeta(localDb, LAST_PULLED_AT_KEY)) ?? EPOCH;
    const lastPushedAt = (await getSyncMeta(localDb, LAST_PUSHED_AT_KEY)) ?? EPOCH;
    console.log(`[Sync] lastPulledAt=${lastPulledAt} lastPushedAt=${lastPushedAt}`);

    // 4. Check remote push_version — skip pull if nothing changed remotely
    let pulled = 0;
    const remotePushVersion = await turso.execute(
      "SELECT value FROM sync_meta WHERE key = 'push_version'",
    );
    const remoteVersion =
      remotePushVersion.rows.length > 0
        ? String(remotePushVersion.rows[0].value ?? remotePushVersion.rows[0][1])
        : null;
    const localVersion = await getSyncMeta(localDb, LAST_SEEN_PUSH_VERSION_KEY);
    const skipPull = !schemaChanged && remoteVersion !== null && remoteVersion === localVersion;
    console.log(
      `[Sync] version check: ${Date.now() - t0}ms (remote=${remoteVersion}, local=${localVersion}, skipPull=${skipPull})`,
    );

    if (skipPull) {
      console.log("[Sync] Remote version unchanged, skipping pull");
    } else {
      // 5. Pull — per-table requests with progress 0.1→0.5
      onLabel?.("Downloading...");
      const pullStartedAt = new Date().toISOString();
      pulled = await pullAll(localDb, turso, lastPulledAt, (p) => onProgress?.(0.1 + p * 0.4));
      console.log(`[Sync] pull: ${Date.now() - t0}ms (${pulled} rows)`);
      await setSyncMeta(localDb, LAST_PULLED_AT_KEY, pullStartedAt);
    }
    onProgress?.(0.5);

    // 6. Push — progress 0.5→1.0 proportional to chunks
    onLabel?.("Uploading...");
    const pushStartedAt = new Date().toISOString();
    const pushed = await pushAll(localDb, turso, lastPushedAt, (p) => onProgress?.(0.5 + p * 0.5));
    await setSyncMeta(localDb, LAST_PUSHED_AT_KEY, pushStartedAt);
    onProgress?.(1);
    onLabel?.("");
    console.log(`[Sync] push: ${Date.now() - t0}ms (${pushed} stmts)`);

    // 7. Sync blob columns (large content synced once, not on every delta cycle)
    const blobs = await syncBlobColumns(localDb, turso);
    if (blobs > 0) {
      console.log(`[Sync] blobs: ${Date.now() - t0}ms (${blobs} synced)`);
      pulled += blobs;
    }

    // 8. push_version was incremented atomically in pushAll's last batch
    if (pushed > 0) {
      const newVersionResult = await turso.execute(
        "SELECT value FROM sync_meta WHERE key = 'push_version'",
      );
      const newVersion = String(newVersionResult.rows[0].value ?? newVersionResult.rows[0][1]);
      await setSyncMeta(localDb, LAST_SEEN_PUSH_VERSION_KEY, newVersion);
    } else if (remoteVersion !== null) {
      // No push, but save remote version locally so next sync can skip pull
      await setSyncMeta(localDb, LAST_SEEN_PUSH_VERSION_KEY, remoteVersion);
    }

    await setSyncMeta(localDb, LAST_SYNC_COMPLETED_AT_KEY, new Date().toISOString());

    console.log(`[Sync] Complete: ${Date.now() - t0}ms total — pulled ${pulled}, pushed ${pushed}`);
    return { ok: true, pulled, pushed };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Error:", errorMsg);
    if (!isNetworkError(err)) {
      captureException(err, { tags: { type: "sync" } });
    }
    return { ok: false, error: errorMsg, pulled: 0, pushed: 0 };
  }
}
