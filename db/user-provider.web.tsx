import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import { makeDefaultListId } from "@/lib/seed-default-lists";
import { setRecoveryDb, DbRecoveryScreen } from "@/components/DbRecoveryScreen";
import { notifyDbError } from "@/components/GlobalErrorHandler";

function isOpfsLockError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("createSyncAccessHandle") ||
    msg.includes("NoModificationAllowedError") ||
    msg.includes("Access Handles cannot be created") ||
    msg.includes("Invalid VFS state")
  );
}

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

  const runInit = useCallback(async () => {
    try {
      const { raw, wrapped } = await openAndMigrateUserDb();
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
      setRecoveryDb(wrapped);
      setState({ userDb: wrapped, isReady: true });
      console.log("[UserDB Web] Initialized successfully");
    } catch (err) {
      console.error("[UserDB Web] Init error:", err);
      setState({
        userDb: null,
        isReady: true,
        error: isOpfsLockError(err) ? "opfs-lock" : String(err),
      });
    }
  }, []);

  useEffect(() => {
    runInit();

    // Register pre-release callback to null out refs/state.
    // The actual VFS close (OPFS handle release) is handled by web-lock.ts.
    let unsubscribe: (() => void) | undefined;
    import("./web-lock").then(({ onReleaseRequested }) => {
      unsubscribe = onReleaseRequested(() => {
        console.log("[UserDB Web] Releasing user DB for another tab");
        rawDbRef.current = null;
        setRecoveryDb(null);
        setState({ userDb: null, isReady: true });
      });
    });

    // Reacquire DB when tab becomes visible again
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !rawDbRef.current) {
        console.log("[UserDB Web] Tab visible, reacquiring user DB...");
        runInit();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribe?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, runInit]);

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
