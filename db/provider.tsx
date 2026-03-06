import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import {
  isDictReady,
  isAudioReady,
  fetchManifest,
  downloadDictionary,
  downloadAudio,
  checkForUpdate,
  getStoredDictVersion,
  setLocalVersion,
  determineUpdateAction,
  loadWebDictDb,
  loadWebAudioDb,
  storeDbBytes,
  type DownloadStatus,
  type DictManifest,
  type BackgroundDownloadItem,
} from "./dict-download";
import { DICT_VERSION } from "./dict-version";
import { runClientDictMigrations } from "./dict-client-migrations";
import { openExtendedDb } from "./extended-db";
import { isExtendedReady, downloadExtendedDb, setExtendedVersion } from "./extended-download";
import { isNativeModuleAvailable } from "@/lib/native-guard";

function isOpfsLockError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("createSyncAccessHandle") ||
    msg.includes("NoModificationAllowedError") ||
    msg.includes("Access Handles cannot be created") ||
    msg.includes("Invalid VFS state")
  );
}

interface DatabaseContextType {
  dictDb: SQLite.SQLiteDatabase | null;
  audioDb: SQLite.SQLiteDatabase | null;
  extendedDb: SQLite.SQLiteDatabase | null;
  isReady: boolean;
  isDownloaded: boolean;
  downloadStatus: DownloadStatus;
  backgroundStatus: BackgroundDownloadItem[];
  startDownload: () => Promise<void>;
  retryManifest: () => Promise<void>;
  triggerBackgroundDownloads: () => void;
}

const DatabaseContext = createContext<DatabaseContextType>({
  dictDb: null,
  audioDb: null,
  extendedDb: null,
  isReady: false,
  isDownloaded: false,
  downloadStatus: { state: "checking" },
  backgroundStatus: [],
  startDownload: async () => {},
  retryManifest: async () => {},
  triggerBackgroundDownloads: () => {},
});

export function useDatabase() {
  return useContext(DatabaseContext);
}

export function useDictDb() {
  const { dictDb } = useDatabase();
  if (!dictDb) throw new Error("Dictionary database not ready");
  return dictDb;
}

/**
 * Open the dict DB. On web, proactively asks other tabs to release
 * their OPFS locks first to prevent VFS corruption.
 */
async function openDictDb(): Promise<SQLite.SQLiteDatabase> {
  if (Platform.OS !== "web") {
    return SQLite.openDatabaseAsync("dictionary.db");
  }

  const { ensureLockAvailable } = await import("./web-lock");
  await ensureLockAvailable();

  const db = await loadWebDictDb();
  if (!db) throw new Error("Dictionary data missing");
  return db;
}

/** Open the audio DB (separate file with just word_audio table). */
async function openAudioDb(): Promise<SQLite.SQLiteDatabase> {
  if (Platform.OS !== "web") {
    return SQLite.openDatabaseAsync("dictionary-audio.db");
  }
  const db = await loadWebAudioDb();
  if (!db) throw new Error("Audio data missing");
  return db;
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [dictDb, setDictDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [audioDb, setAudioDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [extendedDb, setExtendedDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({
    state: "checking",
  });
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundDownloadItem[]>([]);
  const [manifest, setManifest] = useState<DictManifest | null>(null);
  const dictDbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const audioDbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const extendedDbRef = useRef<SQLite.SQLiteDatabase | null>(null);

  // Helper to update a single background item
  const updateBgItem = useCallback((key: string, updates: Partial<BackgroundDownloadItem>) => {
    setBackgroundStatus((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    );
  }, []);

  // Background data init — audio + extended DB
  const initBackgroundData = useCallback(
    async (m?: DictManifest) => {
      const items: BackgroundDownloadItem[] = [];
      const extManifest = m?.extended;

      // Build initial status list — audio first (smaller, more immediately useful)
      if (m?.audioUrl) {
        items.push({ key: "audio", label: "Audio", state: "pending", progress: 0 });
      }
      if (extManifest) {
        items.push({ key: "extended", label: "Extended data", state: "pending", progress: 0 });
      }
      setBackgroundStatus(items);

      // WiFi check — skip large background downloads on cellular
      let onWifi = true;
      if (Platform.OS !== "web" && isNativeModuleAvailable("ExpoNetwork")) {
        try {
          const Network = require("expo-network");
          const state = await Network.getNetworkStateAsync();
          onWifi = state.type === Network.NetworkStateType.WIFI;
          if (!onWifi) {
            console.log("[DB] Not on WiFi, skipping background downloads");
            return;
          }
        } catch {
          // Module check passed but call failed — assume WiFi
        }
      }

      // Audio download first (smaller, immediately useful)
      try {
        const audioReady = await isAudioReady();
        if (!audioReady) {
          if (m?.audioUrl) {
            updateBgItem("audio", { state: "downloading" });
            console.log("[DB] Downloading audio DB in background...");
            await downloadAudio(m, (progress) => {
              updateBgItem("audio", { state: "downloading", progress });
            });
          } else {
            updateBgItem("audio", { state: "ready", progress: 1 });
          }
        }
        const db = await openAudioDb();
        audioDbRef.current = db;
        setAudioDb(db);
        updateBgItem("audio", { state: "ready", progress: 1 });
        console.log("[DB] Audio DB ready");
      } catch (err) {
        console.warn("[DB] Audio init failed (non-blocking):", err);
        updateBgItem("audio", { state: "error", progress: 0 });
      }

      // Extended DB download — pre-built .db file, just download and open
      if (extManifest?.url) {
        try {
          const extReady = await isExtendedReady(extManifest.version);
          if (!extReady) {
            updateBgItem("extended", { state: "downloading" });
            console.log("[DB] Downloading extended DB in background...");
            await downloadExtendedDb(extManifest.url, extManifest.sizeBytes, (progress) => {
              updateBgItem("extended", { state: "downloading", progress });
            });
            await setExtendedVersion(extManifest.version);
          }

          const extDb = await openExtendedDb();
          extendedDbRef.current = extDb;
          setExtendedDb(extDb);
          updateBgItem("extended", { state: "ready", progress: 1 });
          console.log("[DB] Extended DB ready");
        } catch (err) {
          console.warn("[DB] Extended DB init failed (non-blocking):", err);
          updateBgItem("extended", { state: "error", progress: 0 });
        }
      }
    },
    [updateBgItem],
  );

  // Background downloads are deferred until sync completes (or is disabled).
  // SyncProvider calls triggerBackgroundDownloads() after initial sync attempt.
  const manifestForBg = useRef<DictManifest | undefined>(undefined);
  const bgInitStarted = useRef(false);

  const triggerBackgroundDownloads = useCallback(() => {
    if (bgInitStarted.current) return;
    bgInitStarted.current = true;
    initBackgroundData(manifestForBg.current);
  }, [initBackgroundData]);

  // Full init sequence — used on mount and on visibility reacquire
  const runInit = useCallback(async () => {
    try {
      const ready = await isDictReady();

      if (ready) {
        // Check for updates before opening the DB
        let fetchedManifest: DictManifest | undefined;
        try {
          const m = await fetchManifest();
          fetchedManifest = m;
          const hasUpdate = await checkForUpdate(m);
          if (hasUpdate) {
            // Block on update — gate will show download UI
            setManifest(m);
            setIsDownloaded(false);
            setDownloadStatus({ state: "needs-download", manifest: m, isUpdate: true });
            setIsReady(true);
            return;
          }
        } catch {
          // Offline — proceed with existing DB
        }

        const db = await openDictDb();
        dictDbRef.current = db;
        setDictDb(db);
        setIsDownloaded(true);
        setDownloadStatus({ state: "ready" });
        setIsReady(true);

        // Deferred — SyncProvider calls triggerBackgroundDownloads() after sync
        manifestForBg.current = fetchedManifest;
      } else {
        // Dict is not at DICT_VERSION — check if we can apply client migrations
        const localVersion = await getStoredDictVersion();
        let fetchedManifest: DictManifest | undefined;
        try {
          const m = await fetchManifest();
          fetchedManifest = m;
          setManifest(m);
        } catch (err) {
          // Offline — if we have a local DB that needs migrations, we can
          // still run them without the manifest
          if (localVersion !== null) {
            fetchedManifest = undefined;
          } else {
            console.error("[DB] Manifest fetch error:", err);
            const detail = err instanceof Error ? err.message : String(err);
            setIsReady(true);
            setDownloadStatus({
              state: "error",
              message: `Could not reach dictionary server: ${detail}`,
            });
            return;
          }
        }

        // Determine action: full download or client migration?
        const action = fetchedManifest
          ? determineUpdateAction(localVersion, fetchedManifest)
          : localVersion !== null && localVersion < DICT_VERSION
            ? ({
                type: "client-migration",
                fromVersion: localVersion,
                toVersion: DICT_VERSION,
              } as const)
            : ({ type: "none" } as const);

        if (action.type === "client-migration") {
          // Open DB, run lightweight client migrations, update version
          setDownloadStatus({ state: "preparing" });
          console.log(
            `[DB] Running client migrations: v${action.fromVersion} → v${action.toVersion}`,
          );

          const db = await openDictDb();
          const finalVersion = await runClientDictMigrations(
            db,
            action.fromVersion,
            action.toVersion,
          );

          if (Platform.OS === "web" && finalVersion > action.fromVersion) {
            // Web: serialize migrated DB back to IDB so changes persist
            const SQLiteModule = require("expo-sqlite");
            const bytes: Uint8Array = await SQLiteModule.serializeDatabaseAsync(db);
            await storeDbBytes(bytes);
          }

          await setLocalVersion(finalVersion);

          dictDbRef.current = db;
          setDictDb(db);
          setIsDownloaded(true);
          setDownloadStatus({ state: "ready" });
          setIsReady(true);

          // Deferred — SyncProvider calls triggerBackgroundDownloads() after sync
          manifestForBg.current = fetchedManifest;
        } else if (action.type === "full-download") {
          setIsReady(true);
          setDownloadStatus({ state: "needs-download", manifest: action.manifest });
        } else {
          // action.type === "none" — should not normally reach here,
          // but handle gracefully by opening the DB
          const db = await openDictDb();
          dictDbRef.current = db;
          setDictDb(db);
          setIsDownloaded(true);
          setDownloadStatus({ state: "ready" });
          setIsReady(true);
          manifestForBg.current = fetchedManifest;
        }
      }
    } catch (err) {
      console.error("[DB] Init error:", err);
      setIsReady(true);
      setDownloadStatus({
        state: "error",
        message: isOpfsLockError(err)
          ? "opfs-lock"
          : err instanceof Error
            ? err.message
            : "Failed to initialize",
      });
    }
  }, [initBackgroundData]);

  useEffect(() => {
    runInit();

    if (Platform.OS !== "web") return;

    // Register pre-release callback to null out refs/state.
    // The actual VFS close (OPFS handle release) is handled by web-lock.ts.
    let unsubscribe: (() => void) | undefined;
    import("./web-lock").then(({ onReleaseRequested }) => {
      unsubscribe = onReleaseRequested(() => {
        console.log("[DB] Releasing dict DB for another tab");
        dictDbRef.current = null;
        setDictDb(null);
        audioDbRef.current = null;
        setAudioDb(null);
        extendedDbRef.current = null;
        setExtendedDb(null);
      });
    });

    // Reacquire DB when tab becomes visible again
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !dictDbRef.current) {
        console.log("[DB] Tab visible, reacquiring dict DB...");
        runInit();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribe?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runInit]);

  const retryManifest = useCallback(async () => {
    setDownloadStatus({ state: "checking" });
    try {
      const m = await fetchManifest();
      setManifest(m);
      setDownloadStatus({ state: "needs-download", manifest: m });
    } catch (err) {
      console.error("[DB] Manifest fetch error:", err);
      const detail = err instanceof Error ? err.message : String(err);
      setDownloadStatus({
        state: "error",
        message: `Could not reach dictionary server: ${detail}`,
      });
    }
  }, []);

  const startDownload = useCallback(async () => {
    const m = manifest;
    if (!m) return;

    try {
      setDownloadStatus({ state: "downloading", progress: 0 });

      await downloadDictionary(
        m,
        (progress) => setDownloadStatus({ state: "downloading", progress }),
        (status) => {
          if (status === "saving") setDownloadStatus({ state: "preparing" });
        },
      );

      setDownloadStatus({ state: "preparing" });
      const db = await openDictDb();

      // After a fresh download, run client migrations if DICT_VERSION > base
      if (m.version < DICT_VERSION) {
        console.log(`[DB] Post-download client migrations: v${m.version} → v${DICT_VERSION}`);
        const finalVersion = await runClientDictMigrations(db, m.version, DICT_VERSION);

        if (Platform.OS === "web" && finalVersion > m.version) {
          const SQLiteModule = require("expo-sqlite");
          const bytes: Uint8Array = await SQLiteModule.serializeDatabaseAsync(db);
          await storeDbBytes(bytes);
        }

        await setLocalVersion(finalVersion);
      }

      dictDbRef.current = db;
      setDictDb(db);
      setIsDownloaded(true);
      setDownloadStatus({ state: "ready" });

      // Deferred — SyncProvider calls triggerBackgroundDownloads() after sync
      manifestForBg.current = m;
    } catch (err) {
      console.error("[DB] Download error:", err);
      setDownloadStatus({
        state: "error",
        message: isOpfsLockError(err)
          ? "opfs-lock"
          : err instanceof Error
            ? err.message
            : "Download failed",
      });
    }
  }, [manifest, initBackgroundData]);

  return (
    <DatabaseContext.Provider
      value={{
        dictDb,
        audioDb,
        extendedDb,
        isReady,
        isDownloaded,
        downloadStatus,
        backgroundStatus,
        startDownload,
        retryManifest,
        triggerBackgroundDownloads,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}
