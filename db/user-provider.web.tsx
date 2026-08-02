import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import { migrateLegacyMnemonics } from "./mnemonic-migration";
import { makeDefaultListId } from "@/lib/seed-default-lists";
import { cleanupOrphanedSmartLists } from "@/lib/smart-review";
import { setRecoveryDb, DbRecoveryScreen } from "@/components/DbRecoveryScreen";
import { notifyDbError } from "@/components/GlobalErrorHandler";
import { captureException } from "@/lib/sentry";
import { classifyOpenError } from "./db-errors";

// Retries re-run the whole open, and openAndMigrateUserDb() re-calls
// ensureLockAvailable() each time — so every attempt re-asks the holder to
// release, giving a busy tab (mid heavy work) more chances to hand off.
const OPEN_RETRY_LIMIT = 6;
const WEB_REACQUIRE_AFTER_RELEASE_MS = 1000;

interface UserDbContextType {
  userDb: WrappedUserDb | null;
  isReady: boolean;
  error?: string;
}

const UserDbContext = createContext<UserDbContextType>({
  userDb: null,
  isReady: false,
});

export function useUserDb(): WrappedUserDb | null {
  const { userDb } = useContext(UserDbContext);
  return userDb;
}

async function openAndMigrateUserDb(): Promise<{
  raw: SQLite.SQLiteDatabase;
  wrapped: WrappedUserDb;
}> {
  // Proactively ask other tabs to release OPFS locks before opening.
  // Shares the same promise as provider.tsx so only one request is sent.
  const { ensureLockAvailable } = await import("./web-lock");
  await ensureLockAvailable();

  const db = await SQLite.openDatabaseAsync("user.db");
  await db.execAsync("PRAGMA journal_mode = MEMORY");
  await db.execAsync("PRAGMA temp_store = MEMORY");
  await db.execAsync("PRAGMA foreign_keys = ON");

  // Run only pending migrations (tracked via PRAGMA user_version)
  const vr = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = vr?.user_version ?? 0;
  const pending = USER_DB_MIGRATIONS.slice(currentVersion);
  for (const sql of pending) {
    try {
      await db.execAsync(sql);
    } catch (err) {
      if (!String(err).includes("duplicate column")) throw err;
    }
  }
  if (pending.length > 0) {
    await db.execAsync(`PRAGMA user_version = ${USER_DB_MIGRATIONS.length}`);
  }

  const wrapped: WrappedUserDb = {
    getAllAsync: async <T,>(sql: string, params?: any[]): Promise<T[]> => {
      try {
        return await db.getAllAsync<T>(sql, params ?? []);
      } catch (err) {
        console.error(
          "[UserDB Web] getAllAsync FAILED:",
          String(err),
          "\n  SQL:",
          sql.slice(0, 200),
        );
        notifyDbError(err, sql);
        throw err;
      }
    },

    getFirstAsync: async <T,>(sql: string, params?: any[]): Promise<T | null> => {
      try {
        return await db.getFirstAsync<T>(sql, params ?? []);
      } catch (err) {
        console.error(
          "[UserDB Web] getFirstAsync FAILED:",
          String(err),
          "\n  SQL:",
          sql.slice(0, 200),
        );
        notifyDbError(err, sql);
        throw err;
      }
    },

    runAsync: async (sql: string, params?: any[]) => {
      try {
        const result = await db.runAsync(sql, params ?? []);
        return {
          changes: result.changes,
          lastInsertRowId: result.lastInsertRowId,
        };
      } catch (err) {
        console.error("[UserDB Web] runAsync FAILED:", String(err), "\n  SQL:", sql.slice(0, 200));
        notifyDbError(err, sql);
        throw err;
      }
    },

    sync: () => {},
  };

  // Programmatic migration: rename random default IDs → deterministic slugs
  // Disable FKs during migration — UPDATE on PK internally does DELETE+INSERT
  // which triggers CASCADE and destroys the FK references we just updated.
  const migrated = await wrapped.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = 'default_ids_migrated'",
  );
  if (!migrated) {
    await db.execAsync("PRAGMA foreign_keys = OFF");
    const defaults = await wrapped.getAllAsync<{ id: string; name: string }>(
      "SELECT id, name FROM lists WHERE is_default = 1",
    );
    for (const list of defaults) {
      const newId = makeDefaultListId(list.name);
      if (list.id === newId) continue;
      await wrapped.runAsync("UPDATE list_entries SET list_id = ? WHERE list_id = ?", [
        newId,
        list.id,
      ]);
      await wrapped.runAsync("UPDATE srs_cards SET list_id = ? WHERE list_id = ?", [
        newId,
        list.id,
      ]);
      await wrapped.runAsync("UPDATE lists SET id = ? WHERE id = ?", [newId, list.id]);
    }
    // Also migrate default books
    const defaultBooks = await wrapped.getAllAsync<{ id: string; title: string }>(
      "SELECT id, title FROM books WHERE is_default = 1",
    );
    for (const book of defaultBooks) {
      const newId = makeDefaultListId("yume-juuya");
      if (book.id === newId) continue;
      await wrapped.runAsync("UPDATE books SET id = ? WHERE id = ?", [newId, book.id]);
    }
    await wrapped.runAsync(
      "INSERT OR REPLACE INTO app_flags (key, value) VALUES ('default_ids_migrated', '1')",
    );
    await db.execAsync("PRAGMA foreign_keys = ON");
  }

  // One-time conversion of legacy mnemonic markup (**x**/*x*) to the new grammar.
  // Best-effort: a failure must not brick init; the flag is set last so it retries.
  await migrateLegacyMnemonics(wrapped).catch((e) =>
    console.warn("[UserDB Web] legacy mnemonic migration failed:", String(e)),
  );

  return { raw: db, wrapped };
}

export function UserDatabaseProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<UserDbContextType>({
    userDb: null,
    isReady: false,
  });
  const rawDbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reacquireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever a fresh init lifecycle starts (mount, userId change,
  // visibility reacquire, release) or on unmount. Every runInit attempt captures
  // its generation and no-ops after an await if a newer lifecycle superseded it,
  // so a stale retry can never clobber an already-working session.
  const generation = useRef(0);

  const cancelRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const cancelReacquire = useCallback(() => {
    if (reacquireTimer.current) {
      clearTimeout(reacquireTimer.current);
      reacquireTimer.current = null;
    }
  }, []);

  const runInit = useCallback(async (attempt = 0, gen = generation.current) => {
    if (gen !== generation.current) return; // superseded before we even started
    try {
      const { raw, wrapped } = await openAndMigrateUserDb();
      if (gen !== generation.current) return; // superseded while opening
      rawDbRef.current = raw;
      // Cleanup old temporary marked-for-review lists (>24h old) and old review marks (>90 days)
      wrapped
        .runAsync(
          `DELETE FROM lists WHERE id LIKE '_marked_%' AND created_at < datetime('now', '-1 day')`,
        )
        .catch(() => {});
      wrapped
        .runAsync(`DELETE FROM review_marks WHERE marked_at < datetime('now', '-90 days')`)
        .catch(() => {});
      // Smart-review sub-lists are device-local; sweep idle (>30d) and source-missing.
      cleanupOrphanedSmartLists(wrapped).catch(() => {});
      setRecoveryDb(wrapped);
      setState({ userDb: wrapped, isReady: true });
      console.log("[UserDB Web] Initialized successfully");
    } catch (err) {
      if (gen !== generation.current) return; // superseded while failing
      const kind = classifyOpenError(err);
      // Transient OPFS contention — retry with backoff (each attempt re-asks the
      // holder to release) before surfacing anything. Suppress the recovery
      // screen meanwhile by parking in the benign "opfs-lock" state. The retry
      // carries the same generation so a superseded lifecycle stops retrying.
      if ((kind === "lock" || kind === "io") && attempt < OPEN_RETRY_LIMIT) {
        const delay = Math.min(2000, 250 * 2 ** attempt);
        console.warn(
          `[UserDB Web] OPFS ${kind} on open — retry ${attempt + 1}/${OPEN_RETRY_LIMIT} in ${delay}ms:`,
          String(err),
        );
        setState({ userDb: null, isReady: true, error: "opfs-lock" });
        retryTimer.current = setTimeout(() => runInit(attempt + 1, gen), delay);
        return;
      }
      console.error("[UserDB Web] Init error:", err);
      captureException(err, { tags: { type: "database", source: "web_init" } });
      setState({
        userDb: null,
        isReady: true,
        // A lock that never released stays silent (waits for release/visibility);
        // a persistent I/O or fatal error surfaces the recovery screen.
        error: kind === "lock" ? "opfs-lock" : String(err),
      });
    }
  }, []);

  const scheduleReacquire = useCallback(() => {
    cancelReacquire();
    reacquireTimer.current = setTimeout(() => {
      reacquireTimer.current = null;
      if (document.visibilityState !== "visible" || rawDbRef.current) return;

      console.log("[UserDB Web] Reacquiring user DB after release...");
      generation.current += 1;
      cancelRetry();
      runInit(0, generation.current);
    }, WEB_REACQUIRE_AFTER_RELEASE_MS);
  }, [cancelReacquire, cancelRetry, runInit]);

  useEffect(() => {
    generation.current += 1;
    cancelRetry();
    runInit(0, generation.current);

    // Register pre-release callback to null out refs/state.
    // The actual VFS close (OPFS handle release) is handled by web-lock.ts.
    let unsubscribe: (() => void) | undefined;
    import("./web-lock").then(({ onReleaseRequested }) => {
      unsubscribe = onReleaseRequested(() => {
        console.log("[UserDB Web] Releasing user DB for another tab");
        // Invalidate any in-flight/scheduled init: we're giving up the DB.
        generation.current += 1;
        cancelRetry();
        rawDbRef.current = null;
        setRecoveryDb(null);
        setState({ userDb: null, isReady: true });
        scheduleReacquire();
      });
    });

    // Reacquire DB when tab becomes visible again — starts a fresh generation so
    // it can't race a still-pending retry from the previous lifecycle.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !rawDbRef.current) {
        console.log("[UserDB Web] Tab visible, reacquiring user DB...");
        generation.current += 1;
        cancelRetry();
        cancelReacquire();
        runInit(0, generation.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      generation.current += 1; // invalidate any in-flight/scheduled work
      unsubscribe?.();
      cancelRetry();
      cancelReacquire();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, runInit, cancelRetry, scheduleReacquire, cancelReacquire]);

  if (state.error && state.error !== "opfs-lock") {
    return (
      <DbRecoveryScreen
        error={{ message: state.error, source: "Database Init" }}
        onDismiss={() => setState({ userDb: null, isReady: true })}
      />
    );
  }

  return <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>;
}
