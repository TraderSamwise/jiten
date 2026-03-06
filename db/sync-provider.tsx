import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import { AppState, Platform } from "react-native";
import { useUserDb } from "./user-provider";
import { useDatabase } from "./provider";
import { createTursoClient, isSyncEnabled } from "./turso-client";
import { sync, type SyncResult } from "./sync-engine";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { Client } from "@libsql/client/web";

interface SyncContextType {
  syncStatus: "disabled" | "idle" | "syncing" | "error";
  syncProgress: number;
  lastSyncAt: string | null;
  lastError: string | null;
  triggerSync: () => Promise<SyncResult>;
}

const noopResult: SyncResult = { ok: true, pulled: 0, pushed: 0 };

const SyncContext = createContext<SyncContextType>({
  syncStatus: "disabled",
  syncProgress: 0,
  lastSyncAt: null,
  lastError: null,
  triggerSync: async () => noopResult,
});

export function useSync() {
  return useContext(SyncContext);
}

export function SyncProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const userDb = useUserDb();
  const [syncStatus, setSyncStatus] = useState<SyncContextType["syncStatus"]>(
    isSyncEnabled() ? "idle" : "disabled",
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const tursoRef = useRef<Client | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize Turso client
  useEffect(() => {
    if (!isSyncEnabled()) return;
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
  }, [userId]);

  const triggerSync = useCallback(async (): Promise<SyncResult> => {
    if (!isSyncEnabled() || !userDb || !tursoRef.current) return noopResult;
    if (syncingRef.current) return noopResult; // Dedup

    syncingRef.current = true;
    setSyncStatus("syncing");
    setSyncProgress(0);

    try {
      const result = await sync(userDb, tursoRef.current, setSyncProgress);
      if (result.ok) {
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
  }, [userDb]);

  // Sync on mount and foreground
  useEffect(() => {
    if (!isSyncEnabled() || !userDb) return;

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
  }, [userDb, triggerSync]);

  // Periodic sync every 60s
  useEffect(() => {
    if (!isSyncEnabled() || !userDb) return;
    intervalRef.current = setInterval(triggerSync, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userDb, triggerSync]);

  // Start background downloads (audio, extended DB) after initial sync completes.
  // This ensures sync data is available before large downloads begin.
  const { triggerBackgroundDownloads } = useDatabase();
  const bgDownloadsTriggered = useRef(false);

  useEffect(() => {
    if (bgDownloadsTriggered.current) return;
    if (!isSyncEnabled()) {
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
  }, [syncStatus, lastSyncAt, lastError, triggerBackgroundDownloads]);

  return (
    <SyncContext.Provider value={{ syncStatus, syncProgress, lastSyncAt, lastError, triggerSync }}>
      {children}
    </SyncContext.Provider>
  );
}
