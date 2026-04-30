import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import { AppState, Platform } from "react-native";
import { useUserDb } from "./user-provider";
import type { WrappedUserDb } from "./user-db";
import { useDatabase } from "./provider";
import { createTursoClient, isSyncEnabled } from "./turso-client";
import { getTursoToken } from "@/lib/turso-token";
import { env } from "@/lib/env";
import { sync, isNetworkError, type SyncResult } from "./sync-engine";
import { resetLocalUserData, hasLocalData } from "./sync-helpers";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import { getLastUser, setLastUser } from "@/lib/last-user";
import type { Client } from "@libsql/client/web";

/** Reload all in-memory stores from the database after sync or data reset. */
async function reloadStores(userDb: WrappedUserDb) {
  await Promise.all([
    useBookmarkStore.getState().load(userDb),
    useListsStore.getState().load(userDb),
  ]);
}

interface SyncContextType {
  syncStatus: "disabled" | "idle" | "syncing" | "error";
  syncProgress: number;
  syncLabel: string;
  lastSyncAt: string | null;
  lastError: string | null;
  triggerSync: () => Promise<SyncResult>;
  markDirty: () => void;
  isDirty: boolean;
  syncWithChoice: (choice: "merge" | "use-cloud" | "use-local") => Promise<void>;
  isSilentSync: boolean;
  tursoClient: Client | null;
  needsReconciliation: boolean;
  resolveReconciliation: (proceed: boolean) => void;
  needsFirstSyncChoice: boolean;
  resolveFirstSyncChoice: (choice: "use-cloud" | "use-local" | "merge") => void;
}

const noopResult: SyncResult = { ok: true, pulled: 0, pushed: 0 };
export const SYNC_INTERVAL_MS = 30_000; // Sync loop cadence (30s)
export const FORCE_SYNC_EVERY_N = 10; // Every Nth tick, sync unconditionally (10 × 30s = 5 min)
const LAST_SYNC_COMPLETED_AT_KEY = "last_sync_completed_at";
const LAST_PULLED_AT_KEY = "last_pulled_at";
const LAST_PUSHED_AT_KEY = "last_pushed_at";
const LAST_SEEN_PUSH_VERSION_KEY = "last_seen_push_version";

/** Pure decision: should the sync loop fire on this tick? */
export function shouldSyncOnTick(tick: number, isDirty: boolean, forceEveryN: number): boolean {
  return isDirty || tick >= forceEveryN;
}

/** Pure decision: what should happen on app state change? */
export function getStateChangeAction(
  state: "active" | "background",
  isDirty: boolean,
  elapsedMs: number,
  syncIntervalMs: number,
): "visible" | "silent" | "skip" {
  if (state === "active") {
    return isDirty || elapsedMs >= syncIntervalMs ? "visible" : "skip";
  }
  // Going to background
  return isDirty ? "silent" : "skip";
}

const SyncContext = createContext<SyncContextType>({
  syncStatus: "disabled",
  syncProgress: 0,
  syncLabel: "",
  lastSyncAt: null,
  lastError: null,
  triggerSync: async () => noopResult,
  markDirty: () => {},
  isDirty: false,
  syncWithChoice: async () => {},
  isSilentSync: false,
  tursoClient: null,
  needsReconciliation: false,
  resolveReconciliation: () => {},
  needsFirstSyncChoice: false,
  resolveFirstSyncChoice: () => {},
});

export function useSync() {
  return useContext(SyncContext);
}

interface SyncProviderProps {
  userId: string;
  onSignOut?: () => Promise<void>;
  getToken: () => Promise<string | null>;
  children: React.ReactNode;
}

export function SyncProvider({ userId, onSignOut, getToken, children }: SyncProviderProps) {
  const userDb = useUserDb();
  const userDbRef = useRef(userDb);
  userDbRef.current = userDb;
  const isRealUser = userId !== "local" && isSyncEnabled();
  const [syncStatus, setSyncStatus] = useState<SyncContextType["syncStatus"]>(
    isRealUser ? "idle" : "disabled",
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncLabel, setSyncLabel] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [needsFirstSyncChoice, setNeedsFirstSyncChoice] = useState(false);
  const [reconciled, setReconciled] = useState(false);

  const syncingRef = useRef(false);
  const tursoRef = useRef<Client | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loopTickRef = useRef(0);
  const dirtyRef = useRef(false);
  const isOfflineRef = useRef(false);
  const lastSyncCompletedRef = useRef(0);
  const [isDirtyState, setIsDirtyState] = useState(false);
  const [isSilentSync, setIsSilentSync] = useState(false);
  // Len-1 sync queue: if a sync is requested while one is in progress, queue it.
  // If the queued entry was ever non-silent, it stays non-silent (sticky).
  const pendingSyncRef = useRef<{ force: boolean; silent: boolean } | null>(null);

  // Keep getToken in a ref to avoid re-running effects when its identity changes
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Initialize Turso client with scoped token (async — waits for reconciliation)
  useEffect(() => {
    if (!isRealUser || !reconciled) return;
    let cancelled = false;
    (async () => {
      const token = await getTursoToken(userId, getTokenRef.current, env.API_BASE_URL!);
      if (cancelled) return;
      if (!token) {
        // Can't get token — app works locally, sync stays idle
        return;
      }
      try {
        tursoRef.current = createTursoClient(userId, token);
      } catch (err) {
        console.error("[SyncProvider] Failed to create Turso client:", err);
        setSyncStatus("error");
        setLastError(String(err));
        return;
      }
      // Check dirty flag and trigger initial sync
      if (!userDb) return;
      const [dirtyRow, lastSyncRow] = await Promise.all([
        userDb.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = ?", [
          "sync_dirty",
        ]),
        userDb.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = ?", [
          LAST_SYNC_COMPLETED_AT_KEY,
        ]),
      ]);
      if (cancelled) return;
      const wasDirty = !!dirtyRow;
      if (wasDirty) {
        dirtyRef.current = true;
        setIsDirtyState(true);
        doSyncRef.current(true);
      } else {
        // Skip if last sync was within the sync interval
        const elapsed = lastSyncRow ? Date.now() - new Date(lastSyncRow.value).getTime() : Infinity;
        if (elapsed < SYNC_INTERVAL_MS) return;
        doSyncRef.current();
      }
    })();
    return () => {
      cancelled = true;
      tursoRef.current = null;
    };
  }, [userId, isRealUser, reconciled, userDb]);

  // Check for account change before first sync
  useEffect(() => {
    if (!isRealUser || !userDb) return;

    let cancelled = false;
    (async () => {
      const currentDb = userDb;
      const lastUser = await getLastUser();
      if (cancelled || userDbRef.current !== currentDb) return;

      if (lastUser === userId) {
        // Same user — proceed
        setReconciled(true);
      } else if (!lastUser) {
        // First sign-in — check for local data
        let localData = false;
        try {
          localData = await hasLocalData(currentDb);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("Null connection")) return;
          throw err;
        }
        if (cancelled || userDbRef.current !== currentDb) return;
        if (localData) {
          setNeedsFirstSyncChoice(true);
        } else {
          await setLastUser(userId);
          setReconciled(true);
        }
      } else {
        // Different user — need reconciliation
        setNeedsReconciliation(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isRealUser, userDb]);

  const resolveReconciliation = useCallback(
    async (proceed: boolean) => {
      if (proceed && userDb) {
        await resetLocalUserData(userDb);
        await setLastUser(userId);
        await reloadStores(userDb);
        setNeedsReconciliation(false);
        setReconciled(true);
      } else {
        setNeedsReconciliation(false);
        onSignOut?.();
      }
    },
    [userId, userDb, onSignOut],
  );

  const resolveFirstSyncChoice = useCallback(
    async (choice: "use-cloud" | "use-local" | "merge") => {
      if (!userDb) return;
      if (choice === "use-cloud") {
        // Wipe local, pull from cloud
        await resetLocalUserData(userDb);
        await reloadStores(userDb);
      } else if (choice === "use-local") {
        // Reset sync cursors so canonical state pushes fresh without keeping stale windows
        await userDb.runAsync("DELETE FROM sync_meta WHERE key IN (?, ?, ?, ?)", [
          LAST_PULLED_AT_KEY,
          LAST_PUSHED_AT_KEY,
          LAST_SEEN_PUSH_VERSION_KEY,
          LAST_SYNC_COMPLETED_AT_KEY,
        ]);
      }
      // "merge" — just proceed with normal sync (LWW + append)
      await setLastUser(userId);
      setNeedsFirstSyncChoice(false);
      setReconciled(true);
    },
    [userId, userDb],
  );

  const markDirty = useCallback(() => {
    if (!userDb || dirtyRef.current) return;
    dirtyRef.current = true;
    setIsDirtyState(true);
    userDb
      .runAsync("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)", ["sync_dirty", "1"])
      .catch(() => {});
  }, [userDb]);

  const syncWithChoice = useCallback(
    async (choice: "merge" | "use-cloud" | "use-local") => {
      if (!userDb) return;
      if (choice === "use-cloud") {
        await resetLocalUserData(userDb);
        dirtyRef.current = false;
        setIsDirtyState(false);
        await userDb.runAsync("DELETE FROM sync_meta WHERE key = ?", ["sync_dirty"]);
        await reloadStores(userDb);
      } else if (choice === "use-local") {
        // Reset sync cursors so everything pushes fresh
        await userDb.runAsync("DELETE FROM sync_meta WHERE key IN (?, ?, ?, ?)", [
          LAST_PULLED_AT_KEY,
          LAST_PUSHED_AT_KEY,
          LAST_SEEN_PUSH_VERSION_KEY,
          LAST_SYNC_COMPLETED_AT_KEY,
        ]);
      }
      // All paths: trigger a visible forced sync
      await doSyncRef.current(true);
    },
    [userDb],
  );

  // Helper to reset the periodic interval timer (called after successful sync)
  const resetInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    loopTickRef.current = 0;
    intervalRef.current = setInterval(() => {
      loopTickRef.current += 1;
      if (shouldSyncOnTick(loopTickRef.current, dirtyRef.current, FORCE_SYNC_EVERY_N)) {
        loopTickRef.current = 0;
        doSyncRef.current({ silent: true });
      }
    }, SYNC_INTERVAL_MS);
  }, []);

  // We need a ref to doSync so resetInterval and the interval callback
  // always call the latest version without a circular dep.
  const doSyncRef = useRef<
    (opts?: boolean | { force?: boolean; silent?: boolean }) => Promise<SyncResult>
  >(async () => noopResult);

  const doSync = useCallback(
    async (opts?: boolean | { force?: boolean; silent?: boolean }): Promise<SyncResult> => {
      const force = typeof opts === "boolean" ? opts : (opts?.force ?? false);
      const silent = typeof opts === "object" && opts?.silent === true;

      if (!isRealUser || !userDb || !tursoRef.current) return noopResult;

      // If sync in progress, queue this request (len-1 queue, sticky non-silent)
      if (syncingRef.current) {
        const prev = pendingSyncRef.current;
        pendingSyncRef.current = {
          force: force || (prev?.force ?? false),
          silent: silent && (prev?.silent ?? true),
        };
        return noopResult;
      }

      // Skip if offline (but forced syncs still attempt — gives it one shot)
      if (!force && isOfflineRef.current) return noopResult;

      syncingRef.current = true;
      setIsSilentSync(silent);
      setSyncStatus("syncing");
      setSyncProgress(0);
      setSyncLabel("");

      try {
        let pulledRowsAppliedDuringSync = 0;
        const result = await sync(
          userDb,
          tursoRef.current,
          setSyncProgress,
          setSyncLabel,
          async (pulledRows) => {
            pulledRowsAppliedDuringSync = pulledRows;
            await reloadStores(userDb);
          },
        );
        if (result.ok) {
          // Clear offline flag on success
          isOfflineRef.current = false;
          // Clear dirty flag after successful sync
          dirtyRef.current = false;
          setIsDirtyState(false);
          userDb.runAsync("DELETE FROM sync_meta WHERE key = ?", ["sync_dirty"]).catch(() => {});
          // Let the progress bar fill to 100% before hiding
          await new Promise((r) => setTimeout(r, 500));
          setSyncStatus("idle");
          setLastError(null);
          setLastSyncAt(new Date().toISOString());
          lastSyncCompletedRef.current = Date.now();
          // Reset the periodic interval so 1min countdown starts fresh
          resetInterval();
          // Blob pulls happen later in the sync cycle, so do one final reload only if
          // more rows were pulled after the initial download-phase refresh.
          if (result.pulled > pulledRowsAppliedDuringSync) {
            await reloadStores(userDb);
          }
        } else {
          // Classify error: network errors are silent, others show banner
          if (isNetworkError(result.error)) {
            isOfflineRef.current = true;
            setSyncStatus("idle");
          } else {
            setSyncStatus("error");
            setLastError(result.error ?? "Unknown sync error");
          }
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isNetworkError(err)) {
          isOfflineRef.current = true;
          setSyncStatus("idle");
        } else {
          setSyncStatus("error");
          setLastError(msg);
        }
        return { ok: false, error: msg, pulled: 0, pushed: 0 };
      } finally {
        syncingRef.current = false;
        setIsSilentSync(false);
        // Drain queued sync request if any
        const pending = pendingSyncRef.current;
        if (pending) {
          pendingSyncRef.current = null;
          doSyncRef.current(pending);
        }
      }
    },
    [userDb, isRealUser, resetInterval],
  );

  // Public triggerSync: always marks dirty before syncing
  const triggerSync = useCallback((): Promise<SyncResult> => {
    markDirty();
    return doSync(true);
  }, [markDirty, doSync]);

  // Keep doSyncRef up to date
  useEffect(() => {
    doSyncRef.current = doSync;
  }, [doSync]);

  // Foreground/background listener
  useEffect(() => {
    if (!isRealUser || !reconciled) return;

    const handleStateChange = (state: "active" | "background") => {
      if (state === "active") isOfflineRef.current = false;
      const elapsed = Date.now() - lastSyncCompletedRef.current;
      const action = getStateChangeAction(state, dirtyRef.current, elapsed, SYNC_INTERVAL_MS);
      if (action === "visible") doSync();
      else if (action === "silent") doSync({ silent: true });
    };

    if (Platform.OS === "web") {
      const onVisibility = () => {
        handleStateChange(document.visibilityState === "visible" ? "active" : "background");
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    } else {
      const sub = AppState.addEventListener("change", (next) => {
        if (next === "active") handleStateChange("active");
        else if (next === "background" || next === "inactive") handleStateChange("background");
      });
      return () => sub.remove();
    }
  }, [doSync, isRealUser, reconciled]);

  // Periodic sync loop (30s). Dirty-gated, with unconditional sync every Nth tick.
  useEffect(() => {
    if (!isRealUser || !userDb || !reconciled) return;
    loopTickRef.current = 0;
    intervalRef.current = setInterval(() => {
      loopTickRef.current += 1;
      if (shouldSyncOnTick(loopTickRef.current, dirtyRef.current, FORCE_SYNC_EVERY_N)) {
        loopTickRef.current = 0;
        doSyncRef.current({ silent: true });
      }
    }, SYNC_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userDb, isRealUser, reconciled]);

  // Start background downloads (audio, extended DB) after initial sync completes.
  // This ensures sync data is available before large downloads begin.
  const { triggerBackgroundDownloads } = useDatabase();
  const bgDownloadsTriggered = useRef(false);

  useEffect(() => {
    if (bgDownloadsTriggered.current) return;
    if (!isRealUser) {
      bgDownloadsTriggered.current = true;
      triggerBackgroundDownloads();
      return;
    }
    // Wait until first sync attempt has actually completed
    if (
      (syncStatus === "idle" || syncStatus === "error") &&
      (lastSyncAt !== null || lastError !== null)
    ) {
      bgDownloadsTriggered.current = true;
      triggerBackgroundDownloads();
    }
  }, [syncStatus, lastSyncAt, lastError, triggerBackgroundDownloads, isRealUser]);

  return (
    <SyncContext.Provider
      value={{
        syncStatus,
        syncProgress,
        syncLabel,
        lastSyncAt,
        lastError,
        triggerSync,
        markDirty,
        isDirty: isDirtyState,
        syncWithChoice,
        isSilentSync,
        tursoClient: tursoRef.current,
        needsReconciliation,
        resolveReconciliation,
        needsFirstSyncChoice,
        resolveFirstSyncChoice,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
