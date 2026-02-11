import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type DownloadStatus =
  | { state: "checking" }
  | { state: "needs-download"; manifest: DictManifest; isUpdate?: boolean }
  | { state: "downloading"; progress: number }
  | { state: "preparing" }
  | { state: "ready" }
  | { state: "error"; message: string };

export interface DictManifest {
  version: number;
  url: string;
  sizeBytes: number;
}

const VERSION_KEY = "dict-db-version";
const FORMAT_KEY = "dict-db-format";
const CURRENT_FORMAT = 7; // v1: raw OPFS (broken), v2: VFS import (broken), v3: IndexedDB + deserialize, v4: priority column + clean FTS, v5: kanji/kana tags, v6: kanji index + visual similarity, v7: chunked IDB storage
const DB_NAME = "dictionary.db";

import { env } from "@/lib/env";

const MANIFEST_URL = env.DICT_MANIFEST_URL;

async function getLocalVersion(): Promise<number | null> {
  const v = await AsyncStorage.getItem(VERSION_KEY);
  return v ? parseInt(v, 10) : null;
}

async function getLocalFormat(): Promise<number | null> {
  const f = await AsyncStorage.getItem(FORMAT_KEY);
  return f ? parseInt(f, 10) : null;
}

async function setLocalVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(VERSION_KEY, String(version));
  await AsyncStorage.setItem(FORMAT_KEY, String(CURRENT_FORMAT));
}

export async function fetchManifest(): Promise<DictManifest> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
  const data = await res.json();

  // Derive DB download URL from manifest URL (sibling file) if not provided
  if (!data.url) {
    const base = MANIFEST_URL.replace(/\/[^/]+$/, "");
    data.url = `${base}/dictionary.db`;
  }

  return data;
}

export async function isDictReady(): Promise<boolean> {
  const version = await getLocalVersion();
  const format = await getLocalFormat();
  if (version !== null && format !== null && format !== CURRENT_FORMAT) {
    // Stale format detected — clean up old data automatically
    await clearStaleWebData(format);
    await AsyncStorage.removeItem(VERSION_KEY);
    await AsyncStorage.removeItem(FORMAT_KEY);
    return false;
  }
  return version !== null && format === CURRENT_FORMAT;
}

export async function checkForUpdate(manifest: DictManifest): Promise<boolean> {
  const local = await getLocalVersion();
  const format = await getLocalFormat();
  return local === null || format !== CURRENT_FORMAT || manifest.version > local;
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
async function storeDbBytes(data: Uint8Array): Promise<void> {
  const db = await openIdb();
  const numChunks = Math.ceil(data.byteLength / CHUNK_SIZE);
  console.log(`[DB] Storing ${data.byteLength} bytes in ${numChunks} chunks...`);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);

    // Delete old single-value key if it exists (migration from pre-chunk format)
    store.delete(IDB_KEY);

    // Write metadata
    store.put({ numChunks, totalBytes: data.byteLength }, `${IDB_KEY}:meta`);

    // Write each chunk
    for (let i = 0; i < numChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.byteLength);
      store.put(data.slice(start, end), `${IDB_KEY}:chunk:${i}`);
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
async function loadDbBytes(): Promise<Uint8Array | null> {
  const db = await openIdb();

  // Try chunked format first
  const meta: { numChunks: number; totalBytes: number } | undefined = await new Promise(
    (resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(`${IDB_KEY}:meta`);
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
        const req = tx.objectStore(IDB_STORE).get(`${IDB_KEY}:chunk:${i}`);
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
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return data ?? null;
}

/** Load raw bytes and return an in-memory SQLiteDatabase, or null. */
export async function loadWebDictDb(): Promise<import("expo-sqlite").SQLiteDatabase | null> {
  const data = await loadDbBytes();
  if (!data) return null;

  // Patch WAL → rollback journal for memdb VFS compatibility.
  // SQLite header bytes 18-19: 1=rollback, 2=WAL.
  // The memdb VFS used by deserializeDatabaseAsync lacks SHM support
  // required for WAL mode, causing SQLITE_CANTOPEN on any operation.
  if (data[18] === 2) {
    console.log("[DB] Patching WAL mode → rollback journal for memdb compatibility");
    data[18] = 1;
    data[19] = 1;
  }

  console.log("[DB] Deserializing", data.byteLength, "bytes...");
  const SQLite = require("expo-sqlite");
  const sqlDb: import("expo-sqlite").SQLiteDatabase = await SQLite.deserializeDatabaseAsync(data);
  // Force in-memory journal and temp storage to avoid AccessHandlePoolVFS issues
  await sqlDb.execAsync("PRAGMA journal_mode = MEMORY");
  await sqlDb.execAsync("PRAGMA temp_store = MEMORY");
  // Validate the deserialized database works with the prepare/step code path
  const test = await sqlDb.getFirstAsync<{ cnt: number }>(
    "SELECT count(*) as cnt FROM sqlite_master",
  );
  console.log("[DB] Deserialized OK, tables:", test?.cnt);
  return sqlDb;
}
