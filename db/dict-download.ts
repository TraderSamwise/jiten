import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { DICT_BASE_VERSION, DICT_VERSION } from "./dict-version";

export type DownloadStatus =
  | { state: "checking" }
  | { state: "needs-download"; manifest: DictManifest; isUpdate?: boolean }
  | { state: "downloading"; progress: number }
  | { state: "preparing" }
  | { state: "ready" }
  | { state: "error"; message: string };

export interface ExtendedManifest {
  version: number;
  sizeBytes: number;
  url?: string; // derived from manifest base if absent
}

export interface StrokesManifest {
  version: number;
  sizeBytes: number;
  url?: string; // derived from manifest base if absent
}

export interface DictManifest {
  version: number;
  url: string;
  sizeBytes: number;
  compressedSizeBytes?: number;
  audioSizeBytes?: number;
  audioUrl?: string;
  strokes?: StrokesManifest;
  extended?: ExtendedManifest;
}

export interface BackgroundDownloadItem {
  key: string;
  label: string;
  state: "pending" | "downloading" | "importing" | "ready" | "error";
  progress: number; // 0-1
}

export type UpdateAction =
  | { type: "none" }
  | { type: "full-download"; manifest: DictManifest }
  | { type: "client-migration"; fromVersion: number; toVersion: number };

const VERSION_KEY = "dict-db-version";
const FORMAT_KEY = "dict-db-format";
const DB_NAME = "dictionary.db";
const AUDIO_VERSION_KEY = "dict-audio-version";
const AUDIO_DB_NAME = "dictionary-audio.db";

import { env } from "@/lib/env";

async function getLocalVersion(): Promise<number | null> {
  const v = await AsyncStorage.getItem(VERSION_KEY);
  return v ? parseInt(v, 10) : null;
}

async function getLocalFormat(): Promise<number | null> {
  const f = await AsyncStorage.getItem(FORMAT_KEY);
  return f ? parseInt(f, 10) : null;
}

export async function setLocalVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(VERSION_KEY, String(version));
  await AsyncStorage.setItem(FORMAT_KEY, String(DICT_VERSION));
}

export async function fetchManifest(): Promise<DictManifest> {
  const manifestUrl = env.DICT_MANIFEST_URL;
  let res: Response;
  try {
    res = await fetch(manifestUrl);
  } catch (err) {
    throw new Error(`Fetch failed for ${manifestUrl}: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${manifestUrl}`);
  const data = await res.json();

  // Derive DB download URLs from manifest URL (sibling files) if not provided
  const base = manifestUrl.replace(/\/[^/]+$/, "");
  if (!data.url) {
    data.url = `${base}/dictionary.db`;
  }
  if (!data.audioUrl && data.audioSizeBytes) {
    data.audioUrl = `${base}/dictionary-audio.db`;
  }

  // Derive strokes DB URL from manifest base
  if (data.strokes && !data.strokes.url) {
    data.strokes.url = `${base}/dictionary-strokes.db`;
  }

  // Derive extended DB URL from manifest base
  if (data.extended && !data.extended.url) {
    data.extended.url = `${base}/dictionary-extended.db`;
  }

  return data;
}

export async function isDictReady(): Promise<boolean> {
  const version = await getLocalVersion();
  const format = await getLocalFormat();
  if (version !== null && format !== null && format !== DICT_VERSION) {
    // Stale format detected — clean up old data automatically
    await clearStaleWebData(format);
    await AsyncStorage.removeItem(VERSION_KEY);
    await AsyncStorage.removeItem(FORMAT_KEY);
    return false;
  }
  return version !== null && version >= DICT_VERSION && format === DICT_VERSION;
}

/** Get the locally stored dict version (for use by provider init). */
export async function getStoredDictVersion(): Promise<number | null> {
  return getLocalVersion();
}

export async function checkForUpdate(manifest: DictManifest): Promise<boolean> {
  const local = await getLocalVersion();
  const format = await getLocalFormat();
  return local === null || format !== DICT_VERSION || manifest.version > local;
}

/**
 * Determine what action is needed to bring the local dict up to DICT_VERSION.
 *
 * @param localVersion  version stored in AsyncStorage (null if no DB downloaded)
 * @param manifest      published manifest from GitHub
 */
export function determineUpdateAction(
  localVersion: number | null,
  manifest: DictManifest,
): UpdateAction {
  if (localVersion !== null && localVersion >= DICT_VERSION) {
    return { type: "none" };
  }
  if (localVersion === null || localVersion < DICT_BASE_VERSION) {
    return { type: "full-download", manifest };
  }
  // localVersion >= DICT_BASE_VERSION && localVersion < DICT_VERSION
  return { type: "client-migration", fromVersion: localVersion, toVersion: DICT_VERSION };
}

export async function downloadDictionary(
  manifest: DictManifest,
  onProgress?: (progress: number) => void,
  onStatusChange?: (status: string) => void,
): Promise<void> {
  if (Platform.OS === "web") {
    await downloadWeb(manifest, onProgress, onStatusChange);
  } else {
    await downloadNative(manifest, onProgress);
  }
  await setLocalVersion(manifest.version);
}

/** Clean up data left behind by previous broken download formats. */
async function clearStaleWebData(oldFormat: number): Promise<void> {
  if (Platform.OS !== "web") return;
  try {
    // Format v1 wrote raw file to OPFS root
    if (oldFormat <= 1) {
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry(DB_NAME);
      } catch {}
    }
    // Format v2 may have imported into wa-sqlite VFS
    if (oldFormat <= 2) {
      try {
        const SQLite = require("expo-sqlite");
        await SQLite.deleteDatabaseAsync(DB_NAME);
      } catch {}
    }
    // Clear any old IndexedDB store (in case of partial/corrupt data)
    try {
      const db = await openIdb();
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      // Clear everything (old single-value key + chunked keys)
      store.clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch {}
  } catch (err) {
    console.warn("[DB] Error cleaning stale data:", err);
  }
}

async function downloadNative(
  manifest: DictManifest,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const FileSystem = require("expo-file-system/legacy");

  const dbDir = `${FileSystem.documentDirectory}SQLite/`;
  await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });

  const destPath = `${dbDir}${DB_NAME}`;

  const download = FileSystem.createDownloadResumable(
    manifest.url,
    destPath,
    {},
    (downloadProgress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      const progress =
        downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      onProgress?.(progress);
    },
  );

  const result = await download.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`Download failed with status ${result?.status}`);
  }
}

async function downloadWeb(
  manifest: DictManifest,
  onProgress?: (progress: number) => void,
  onStatusChange?: (status: string) => void,
): Promise<void> {
  // 1. Download with progress tracking
  const res = await fetch(manifest.url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported");

  const contentLength = manifest.sizeBytes;
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(contentLength > 0 ? received / contentLength : 0);
  }

  // 2. Concatenate chunks into a single Uint8Array
  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }

  // 3. Store raw SQLite bytes in IndexedDB (chunked to avoid value-size limits)
  onStatusChange?.("saving");
  await storeDbBytes(data);
}

const IDB_NAME = "dict-store";
const IDB_STORE = "db";
const IDB_KEY = "dictionary";
const CHUNK_SIZE = 64 * 1024 * 1024; // 64 MB per chunk (well under IDB limits)

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Store DB bytes split into chunks to stay under IDB value-size limits. */
export async function storeDbBytes(data: Uint8Array, keyPrefix: string = IDB_KEY): Promise<void> {
  const db = await openIdb();
  const numChunks = Math.ceil(data.byteLength / CHUNK_SIZE);
  console.log(`[DB] Storing ${data.byteLength} bytes (${keyPrefix}) in ${numChunks} chunks...`);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);

    // Delete old single-value key if it exists (migration from pre-chunk format)
    store.delete(keyPrefix);

    // Write metadata
    store.put({ numChunks, totalBytes: data.byteLength }, `${keyPrefix}:meta`);

    // Write each chunk
    for (let i = 0; i < numChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.byteLength);
      store.put(data.slice(start, end), `${keyPrefix}:chunk:${i}`);
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("Transaction aborted"));
    };
  });
}

/** Load chunked DB bytes from IndexedDB, reassembling into a single Uint8Array. */
async function loadDbBytes(keyPrefix: string = IDB_KEY): Promise<Uint8Array | null> {
  const db = await openIdb();

  // Try chunked format first
  const meta: { numChunks: number; totalBytes: number } | undefined = await new Promise(
    (resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(`${keyPrefix}:meta`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    },
  );

  if (meta?.numChunks) {
    const result = new Uint8Array(meta.totalBytes);
    let offset = 0;

    for (let i = 0; i < meta.numChunks; i++) {
      const chunk: Uint8Array | undefined = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(`${keyPrefix}:chunk:${i}`);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!chunk) {
        db.close();
        return null;
      }
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    db.close();
    return result;
  }

  // Fallback: try old single-value format (migration path)
  const data: Uint8Array | undefined = await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(keyPrefix);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return data ?? null;
}

/** Deserialize raw SQLite bytes into an in-memory database. */
async function deserializeWebDb(
  data: Uint8Array,
  label: string,
): Promise<import("expo-sqlite").SQLiteDatabase> {
  // Patch WAL → rollback journal for memdb VFS compatibility.
  // SQLite header bytes 18-19: 1=rollback, 2=WAL.
  // The memdb VFS used by deserializeDatabaseAsync lacks SHM support
  // required for WAL mode, causing SQLITE_CANTOPEN on any operation.
  if (data[18] === 2) {
    console.log(`[DB] Patching WAL mode → rollback journal for ${label}`);
    data[18] = 1;
    data[19] = 1;
  }

  console.log(`[DB] Deserializing ${label}:`, data.byteLength, "bytes...");
  const SQLite = require("expo-sqlite");
  const sqlDb: import("expo-sqlite").SQLiteDatabase = await SQLite.deserializeDatabaseAsync(data);
  // Force in-memory journal and temp storage to avoid AccessHandlePoolVFS issues
  await sqlDb.execAsync("PRAGMA journal_mode = MEMORY");
  await sqlDb.execAsync("PRAGMA temp_store = MEMORY");
  // Validate the deserialized database works with the prepare/step code path
  const test = await sqlDb.getFirstAsync<{ cnt: number }>(
    "SELECT count(*) as cnt FROM sqlite_master",
  );
  console.log(`[DB] Deserialized ${label} OK, tables:`, test?.cnt);
  return sqlDb;
}

/** Load raw bytes and return an in-memory SQLiteDatabase, or null. */
export async function loadWebDictDb(): Promise<import("expo-sqlite").SQLiteDatabase | null> {
  const data = await loadDbBytes();
  if (!data) return null;
  return deserializeWebDb(data, "dict");
}

// ─── Audio DB support ───

export async function isAudioReady(): Promise<boolean> {
  const v = await AsyncStorage.getItem(AUDIO_VERSION_KEY);
  return v !== null && parseInt(v, 10) === DICT_VERSION;
}

const AUDIO_RESUME_KEY = "audio-download-resume";

export async function downloadAudio(
  manifest: DictManifest,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const audioUrl = manifest.audioUrl;
  if (!audioUrl) throw new Error("No audio URL in manifest");

  if (Platform.OS === "web") {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`Audio download failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const contentLength = manifest.audioSizeBytes ?? 0;
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(contentLength > 0 ? received / contentLength : 0);
    }

    const data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    await storeDbBytes(data, "dictionary-audio");
  } else {
    await downloadAudioNativeResumable(audioUrl, manifest.audioSizeBytes ?? 0, onProgress);
  }

  await AsyncStorage.setItem(AUDIO_VERSION_KEY, String(DICT_VERSION));
}

/** Native audio download with resume support via persisted DownloadResumable state. */
async function downloadAudioNativeResumable(
  audioUrl: string,
  totalBytes: number,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const FileSystem = require("expo-file-system/legacy");
  const { AppState } = require("react-native");

  const dbDir = `${FileSystem.documentDirectory}SQLite/`;
  await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
  const destPath = `${dbDir}${AUDIO_DB_NAME}`;

  let lastSavedProgress = 0;

  const progressCallback = (dp: {
    totalBytesWritten: number;
    totalBytesExpectedToWrite: number;
  }) => {
    const progress = dp.totalBytesWritten / dp.totalBytesExpectedToWrite;
    onProgress?.(progress);
    lastSavedProgress = progress;
  };

  // Try to resume from saved state
  const savedState = await AsyncStorage.getItem(AUDIO_RESUME_KEY);
  let download: any;
  let result: any;

  if (savedState) {
    try {
      const resumeData = JSON.parse(savedState);
      console.log("[DB] Resuming audio download from saved state...");
      download = new FileSystem.DownloadResumable(
        audioUrl,
        destPath,
        {},
        progressCallback,
        resumeData,
      );
      result = await download.resumeAsync();
    } catch (err) {
      console.warn("[DB] Audio resume failed, starting fresh:", err);
      // Clear stale resume data and start fresh
      await AsyncStorage.removeItem(AUDIO_RESUME_KEY);
      download = null;
      result = null;
    }
  }

  if (!result) {
    download = FileSystem.createDownloadResumable(audioUrl, destPath, {}, progressCallback);

    // Save state when app goes to background so we can resume later
    const subscription = AppState.addEventListener("change", async (state: string) => {
      if (state === "background" || state === "inactive") {
        try {
          const savable = download.savable();
          await AsyncStorage.setItem(AUDIO_RESUME_KEY, JSON.stringify(savable));
          console.log(`[DB] Audio download state saved at ${Math.round(lastSavedProgress * 100)}%`);
          await download.pauseAsync();
        } catch {
          // Already completed or not started — ignore
        }
      }
    });

    try {
      result = await download.downloadAsync();
    } finally {
      subscription.remove();
    }
  }

  if (!result || result.status !== 200) {
    throw new Error(`Audio download failed with status ${result?.status}`);
  }

  // Clear saved resume state on success
  await AsyncStorage.removeItem(AUDIO_RESUME_KEY);
}

/** Load audio DB bytes from IndexedDB and return an in-memory SQLiteDatabase. */
export async function loadWebAudioDb(): Promise<import("expo-sqlite").SQLiteDatabase | null> {
  const data = await loadDbBytes("dictionary-audio");
  if (!data) return null;
  return deserializeWebDb(data, "audio");
}

// ─── Extended DB support ───

const EXT_VERSION_KEY = "ext-db-version";
const EXT_DB_NAME = "dictionary-extended.db";

export async function isExtendedReady(version: number): Promise<boolean> {
  const v = await AsyncStorage.getItem(EXT_VERSION_KEY);
  return v !== null && parseInt(v, 10) >= version;
}

export async function downloadExtendedDb(
  url: string,
  sizeBytes: number,
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (Platform.OS === "web") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Extended DB download failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(sizeBytes > 0 ? received / sizeBytes : 0);
    }

    const data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    await storeDbBytes(data, "dictionary-extended");
  } else {
    const FileSystem = require("expo-file-system/legacy");
    const dbDir = `${FileSystem.documentDirectory}SQLite/`;
    await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    const destPath = `${dbDir}${EXT_DB_NAME}`;

    const download = FileSystem.createDownloadResumable(
      url,
      destPath,
      {},
      (dp: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        onProgress?.(dp.totalBytesWritten / dp.totalBytesExpectedToWrite);
      },
    );

    const result = await download.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Extended DB download failed with status ${result?.status}`);
    }
  }
}

export async function setExtendedVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(EXT_VERSION_KEY, String(version));
}

/** Load extended DB bytes from IndexedDB and return an in-memory SQLiteDatabase. */
export async function loadWebExtendedDb(): Promise<import("expo-sqlite").SQLiteDatabase | null> {
  const data = await loadDbBytes("dictionary-extended");
  if (!data) return null;
  return deserializeWebDb(data, "extended");
}

// ─── Strokes DB support ───

const STROKES_VERSION_KEY = "strokes-db-version";
const STROKES_DB_NAME = "dictionary-strokes.db";

export async function isStrokesReady(version: number): Promise<boolean> {
  const v = await AsyncStorage.getItem(STROKES_VERSION_KEY);
  return v !== null && parseInt(v, 10) >= version;
}

export async function downloadStrokesDb(
  url: string,
  sizeBytes: number,
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (Platform.OS === "web") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Strokes DB download failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(sizeBytes > 0 ? received / sizeBytes : 0);
    }

    const data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    await storeDbBytes(data, "dictionary-strokes");
  } else {
    const FileSystem = require("expo-file-system/legacy");
    const dbDir = `${FileSystem.documentDirectory}SQLite/`;
    await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    const destPath = `${dbDir}${STROKES_DB_NAME}`;

    const download = FileSystem.createDownloadResumable(
      url,
      destPath,
      {},
      (dp: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        onProgress?.(dp.totalBytesWritten / dp.totalBytesExpectedToWrite);
      },
    );

    const result = await download.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Strokes DB download failed with status ${result?.status}`);
    }
  }
}

export async function setStrokesVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(STROKES_VERSION_KEY, String(version));
}

/** Open the strokes database. */
export async function openStrokesDb(): Promise<import("expo-sqlite").SQLiteDatabase> {
  if (Platform.OS === "web") {
    const { ensureLockAvailable } = await import("./web-lock");
    await ensureLockAvailable();
    const db = await loadWebStrokesDb();
    if (!db) throw new Error("Strokes data missing");
    return db;
  }
  const SQLite = require("expo-sqlite");
  return SQLite.openDatabaseAsync(STROKES_DB_NAME);
}

/** Load strokes DB bytes from IndexedDB and return an in-memory SQLiteDatabase. */
export async function loadWebStrokesDb(): Promise<import("expo-sqlite").SQLiteDatabase | null> {
  const data = await loadDbBytes("dictionary-strokes");
  if (!data) return null;
  return deserializeWebDb(data, "strokes");
}
