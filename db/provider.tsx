import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SQLite from "expo-sqlite";
import {
  isDictReady,
  fetchManifest,
  downloadDictionary,
  checkForUpdate,
  type DownloadStatus,
  type DictManifest,
} from "./dict-download";

interface DatabaseContextType {
  dictDb: SQLite.SQLiteDatabase | null;
  isReady: boolean;
  isDownloaded: boolean;
  downloadStatus: DownloadStatus;
  startDownload: () => Promise<void>;
  retryManifest: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType>({
  dictDb: null,
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

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [dictDb, setDictDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({
    state: "checking",
  });
  const [manifest, setManifest] = useState<DictManifest | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const ready = await isDictReady();

        if (ready) {
          const db = await SQLite.openDatabaseAsync("dictionary.db");
          setDictDb(db);
          setIsDownloaded(true);
          setDownloadStatus({ state: "ready" });
          setIsReady(true);

          // Check for updates in background
          fetchManifest()
            .then(async (m) => {
              const hasUpdate = await checkForUpdate(m);
              if (hasUpdate) setManifest(m);
            })
            .catch(() => {});
        } else {
          setIsReady(true);
          // Fetch manifest to show download size
          try {
            const m = await fetchManifest();
            setManifest(m);
            setDownloadStatus({ state: "needs-download", manifest: m });
          } catch (err) {
            console.error("[DB] Manifest fetch error:", err);
            setDownloadStatus({
              state: "error",
              message: "Could not reach dictionary server. Check your connection and try again.",
            });
          }
        }
      } catch (err) {
        console.error("[DB] Init error:", err);
        setIsReady(true);
        setDownloadStatus({
          state: "error",
          message: err instanceof Error ? err.message : "Failed to initialize",
        });
      }
    }

    init();
  }, []);

  const retryManifest = useCallback(async () => {
    setDownloadStatus({ state: "checking" });
    try {
      const m = await fetchManifest();
      setManifest(m);
      setDownloadStatus({ state: "needs-download", manifest: m });
    } catch (err) {
      console.error("[DB] Manifest fetch error:", err);
      setDownloadStatus({
        state: "error",
        message: "Could not reach dictionary server. Check your connection and try again.",
      });
    }
  }, []);

  const startDownload = useCallback(async () => {
    const m = manifest;
    if (!m) return;

    try {
      setDownloadStatus({ state: "downloading", progress: 0 });

      await downloadDictionary(m, (progress) => {
        setDownloadStatus({ state: "downloading", progress });
      });

      const db = await SQLite.openDatabaseAsync("dictionary.db");
      setDictDb(db);
      setIsDownloaded(true);
      setDownloadStatus({ state: "ready" });
    } catch (err) {
      console.error("[DB] Download error:", err);
      setDownloadStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Download failed",
      });
    }
  }, [manifest]);

  return (
    <DatabaseContext.Provider
      value={{ dictDb, isReady, isDownloaded, downloadStatus, startDownload, retryManifest }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}
