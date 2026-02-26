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
  loadWebDictDb,
  loadWebAudioDb,
  type DownloadStatus,
  type DictManifest,
} from "./dict-download";

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
  isReady: boolean;
  isDownloaded: boolean;
  downloadStatus: DownloadStatus;
  startDownload: () => Promise<void>;
  retryManifest: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType>({
  dictDb: null,
  audioDb: null,
  isReady: false,
  isDownloaded: false,
  downloadStatus: { state: "checking" },
  startDownload: async () => {},
  retryManifest: async () => {},
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
  const [isReady, setIsReady] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({
    state: "checking",
  });
  const [manifest, setManifest] = useState<DictManifest | null>(null);
  const dictDbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const audioDbRef = useRef<SQLite.SQLiteDatabase | null>(null);

  // Background audio init — downloads if needed, then opens audio DB
  const initAudio = useCallback(async (m?: DictManifest) => {
    try {
      const ready = await isAudioReady();
      if (!ready) {
        if (m?.audioUrl) {
          console.log("[DB] Downloading audio DB in background...");
          await downloadAudio(m);
        } else {
          return; // Can't download without manifest/audioUrl
        }
      }
      const db = await openAudioDb();
      audioDbRef.current = db;
      setAudioDb(db);
      console.log("[DB] Audio DB ready");
    } catch (err) {
      console.warn("[DB] Audio init failed (non-blocking):", err);
    }
  }, []);

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

        // Fire-and-forget audio init (downloads in background if needed)
        initAudio(fetchedManifest);
      } else {
        setIsReady(true);
        // Fetch manifest to show download size
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
  }, [initAudio]);

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
      dictDbRef.current = db;
      setDictDb(db);
      setIsDownloaded(true);
      setDownloadStatus({ state: "ready" });

      // Fire-and-forget audio init after fresh core download
      initAudio(m);
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
  }, [manifest, initAudio]);

  return (
    <DatabaseContext.Provider
      value={{
        dictDb,
        audioDb,
        isReady,
        isDownloaded,
        downloadStatus,
        startDownload,
        retryManifest,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}
