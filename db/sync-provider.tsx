import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import { AppState, Platform } from "react-native";
import { useUserDb } from "./user-provider";
import { useDatabase } from "./provider";
import { createTursoClient, isSyncEnabled } from "./turso-client";
import { sync, isNetworkError, type SyncResult } from "./sync-engine";
import { resetLocalUserData, hasLocalData } from "./sync-helpers";
import { useBookmarkStore } from "@/stores/bookmarks";
import { getLastUser, setLastUser } from "@/lib/last-user";
import type { Client } from "@libsql/client/web";

interface SyncContextType {
  syncStatus: "disabled" | "idle" | "syncing" | "error";
  syncProgress: number;
  syncLabel: string;
  lastSyncAt: string | null;
  lastError: string | null;
  triggerSync: (opts?: boolean | { force?: boolean; silent?: boolean }) => Promise<SyncResult>;
  markDirty: () => void;
  isSilentSync: boolean;
  tursoClient: Client | null;
  needsReconciliation: boolean;
  resolveReconciliation: (proceed: boolean) => void;
  needsFirstSyncChoice: boolean;
  resolveFirstSyncChoice: (choice: "use-cloud" | "use-local" | "merge") => void;
}

const noopResult: SyncResult = { ok: true, pulled: 0, pushed: 0 };

const SyncContext = createContext<SyncContextType>({
  syncStatus: "disabled",
  syncProgress: 0,
  syncLabel: "",
  lastSyncAt: null,
  lastError: null,
  triggerSync: async () => noopResult,
  markDirty: () => {},
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
  children: React.ReactNode;
}

export function SyncProvider({ userId, onSignOut, children }: SyncProviderProps) {
  const userDb = useUserDb();
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
  const dirtyRef = useRef(false);
  const isOfflineRef = useRef(false);
  const [isSilentSync, setIsSilentSync] = useState(false);
  // Len-1 sync queue: if a sync is requested while one is in progress, queue it.
  // If the queued entry was ever non-silent, it stays non-silent (sticky).
  const pendingSyncRef = useRef<{ force: boolean; silent: boolean } | null>(null);

  // Initialize Turso client
  useEffect(() => {
    if (!isRealUser) return;
    try {
      tursoRef.current = createTursoClient(userId);
    } catch (err) {
      console.error("[SyncProvider] Failed to create Turso client:", err);
      setSyncStatus("error");
      setLastError(String(err));
    }
    return () => {
      tursoRef.current = null;
    };
  }, [userId, isRealUser]);

  // Check for account change before first sync
  useEffect(() => {
    if (!isRealUser || !userDb) return;

    let cancelled = false;
    (async () => {
      const lastUser = await getLastUser();
      if (cancelled) return;

      if (lastUser === userId) {
        // Same user — proceed
        setReconciled(true);
      } else if (!lastUser) {
        // First sign-in — check for local data
        const localData = await hasLocalData(userDb);
        if (cancelled) return;
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
        useBookmarkStore.getState().load(userDb);
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
        useBookmarkStore.getState().load(userDb);
      } else if (choice === "use-local") {
        // Reset sync state so everything pushes fresh
        await userDb.runAsync("DELETE FROM sync_meta");
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
    userDb
      .runAsync("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)", ["sync_dirty", "1"])
      .catch(() => {});
  }, [userDb]);

  // Helper to reset the periodic interval timer (called after successful sync)
  const resetInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => triggerSyncRef.current({ silent: true }), 120_000);
  }, []);

  // We need a ref to triggerSync so resetInterval and the interval callback
  // always call the latest version without a circular dep.
  const triggerSyncRef = useRef<
    (opts?: boolean | { force?: boolean; silent?: boolean }) => Promise<SyncResult>
  >(async () => noopResult);

  const triggerSync = useCallback(
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
        const result = await sync(userDb, tursoRef.current, setSyncProgress, setSyncLabel);
        if (result.ok) {
          // Clear offline flag on success
          isOfflineRef.current = false;
          // Clear dirty flag after successful sync
          dirtyRef.current = false;
          userDb.runAsync("DELETE FROM sync_meta WHERE key = ?", ["sync_dirty"]).catch(() => {});
          // Let the progress bar fill to 100% before hiding
          await new Promise((r) => setTimeout(r, 500));
          setSyncStatus("idle");
          setLastError(null);
          setLastSyncAt(new Date().toISOString());
          // Reset the periodic interval so 2min countdown starts fresh
          resetInterval();
          // Reload in-memory stores if data was pulled from remote
          if (result.pulled > 0) {
            useBookmarkStore.getState().load(userDb);
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
          triggerSyncRef.current(pending);
        }
      }
    },
    [userDb, isRealUser, resetInterval],
  );

  // Keep triggerSyncRef up to date
  useEffect(() => {
    triggerSyncRef.current = triggerSync;
  }, [triggerSync]);

  // Sync on mount and foreground — only after reconciliation passes
  useEffect(() => {
    if (!isRealUser || !userDb || !reconciled) return;

    // Check dirty flag on mount — if set, force immediate sync
    (async () => {
      const row = await userDb.getFirstAsync<{ value: string }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        ["sync_dirty"],
      );
      if (row) {
        dirtyRef.current = true;
        triggerSync(true);
      } else {
        triggerSync();
      }
    })();

    // Foreground listener — clear offline flag and retry
    if (Platform.OS === "web") {
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          isOfflineRef.current = false;
          triggerSync();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    } else {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          isOfflineRef.current = false;
          triggerSync();
        }
      });
      return () => sub.remove();
    }
  }, [userDb, triggerSync, isRealUser, reconciled]);

  // Periodic sync every 2 minutes
  useEffect(() => {
    if (!isRealUser || !userDb || !reconciled) return;
    intervalRef.current = setInterval(() => triggerSyncRef.current({ silent: true }), 120_000);
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
