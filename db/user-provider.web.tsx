import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "./user-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";

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
    getAllAsync: <T,>(sql: string, params?: any[]): Promise<T[]> =>
      db.getAllAsync<T>(sql, params ?? []),

    getFirstAsync: <T,>(sql: string, params?: any[]): Promise<T | null> =>
      db.getFirstAsync<T>(sql, params ?? []),

    runAsync: async (sql: string, params?: any[]) => {
      const result = await db.runAsync(sql, params ?? []);
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },

    sync: () => {},
  };

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

  return <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>;
}
