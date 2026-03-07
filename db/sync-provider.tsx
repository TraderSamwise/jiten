import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import { AppState, Platform } from "react-native";
import { useUserDb } from "./user-provider";
import { useDatabase } from "./provider";
import { createTursoClient, isSyncEnabled } from "./turso-client";
import { sync, type SyncResult } from "./sync-engine";
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
  triggerSync: (force?: boolean) => Promise<SyncResult>;
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

  const triggerSync = useCallback(
    async (force = false): Promise<SyncResult> => {
      if (!isRealUser || !userDb || !tursoRef.current) return noopResult;
      if (syncingRef.current) return noopResult; // Dedup

      // Throttle: skip if last sync was within 5 minutes (unless forced)
      if (!force) {
        const row = await userDb.getFirstAsync<{ value: string }>(
          "SELECT value FROM sync_meta WHERE key = ?",
          ["last_sync_at"],
        );
        if (row && Date.now() - new Date(row.value).getTime() < 5 * 60_000) {
          return noopResult;
        }
      }

      syncingRef.current = true;
      setSyncStatus("syncing");
      setSyncProgress(0);
      setSyncLabel("");

      try {
        const result = await sync(userDb, tursoRef.current, setSyncProgress, setSyncLabel);
        if (result.ok) {
          // Let the progress bar fill to 100% before hiding
          await new Promise((r) => setTimeout(r, 500));
          setSyncStatus("idle");
          setLastError(null);
          setLastSyncAt(new Date().toISOString());
          // Reload in-memory stores if data was pulled from remote
          if (result.pulled > 0) {
            useBookmarkStore.getState().load(userDb);
          }
        } else {
          setSyncStatus("error");
          setLastError(result.error ?? "Unknown sync error");
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSyncStatus("error");
        setLastError(msg);
        return { ok: false, error: msg, pulled: 0, pushed: 0 };
      } finally {
        syncingRef.current = false;
      }
    },
    [userDb, isRealUser],
  );

  // Sync on mount and foreground — only after reconciliation passes
  useEffect(() => {
    if (!isRealUser || !userDb || !reconciled) return;

    // Initial sync
    triggerSync();

    // Foreground listener
    if (Platform.OS === "web") {
      const onVisibility = () => {
        if (document.visibilityState === "visible") triggerSync();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    } else {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") triggerSync();
      });
      return () => sub.remove();
    }
  }, [userDb, triggerSync, isRealUser, reconciled]);

  // Periodic sync every 5 minutes
  useEffect(() => {
    if (!isRealUser || !userDb || !reconciled) return;
    intervalRef.current = setInterval(triggerSync, 300_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userDb, triggerSync, isRealUser, reconciled]);

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
