import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type DownloadStatus =
  | { state: "checking" }
  | { state: "needs-download"; manifest: DictManifest }
  | { state: "downloading"; progress: number }
  | { state: "ready" }
  | { state: "error"; message: string };

export interface DictManifest {
  version: number;
  url: string;
  sizeBytes: number;
}

const VERSION_KEY = "dict-db-version";
const DB_NAME = "dictionary.db";

const MANIFEST_URL =
  process.env.EXPO_PUBLIC_DICT_MANIFEST_URL ??
  "https://your-cdn.com/dict-manifest.json";

async function getLocalVersion(): Promise<number | null> {
  const v = await AsyncStorage.getItem(VERSION_KEY);
  return v ? parseInt(v, 10) : null;
}

async function setLocalVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(VERSION_KEY, String(version));
}

export async function fetchManifest(): Promise<DictManifest> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
  return res.json();
}

export async function isDictReady(): Promise<boolean> {
  const version = await getLocalVersion();
  return version !== null;
}

export async function checkForUpdate(
  manifest: DictManifest
): Promise<boolean> {
  const local = await getLocalVersion();
  return local === null || manifest.version > local;
}

export async function downloadDictionary(
  manifest: DictManifest,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (Platform.OS === "web") {
    await downloadWeb(manifest, onProgress);
  } else {
    await downloadNative(manifest, onProgress);
  }
  await setLocalVersion(manifest.version);
}

async function downloadNative(
  manifest: DictManifest,
  onProgress?: (progress: number) => void
): Promise<void> {
  const FileSystem = require("expo-file-system");

  const dbDir = `${FileSystem.documentDirectory}SQLite/`;
  const dirInfo = await FileSystem.getInfoAsync(dbDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
  }

  const destPath = `${dbDir}${DB_NAME}`;

  const download = FileSystem.createDownloadResumable(
    manifest.url,
    destPath,
    {},
    (downloadProgress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      const progress =
        downloadProgress.totalBytesWritten /
        downloadProgress.totalBytesExpectedToWrite;
      onProgress?.(progress);
    }
  );

  const result = await download.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`Download failed with status ${result?.status}`);
  }
}

async function downloadWeb(
  manifest: DictManifest,
  onProgress?: (progress: number) => void
): Promise<void> {
  const SQLite = await import("expo-sqlite");

  const res = await fetch(manifest.url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported");

  const contentLength = manifest.sizeBytes;
  const chunks: BlobPart[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(contentLength > 0 ? received / contentLength : 0);
  }

  const blob = new Blob(chunks);
  const blobUrl = URL.createObjectURL(blob);

  try {
    // Import the downloaded DB into expo-sqlite's OPFS storage
    await (SQLite as any).importAssetDatabaseAsync(
      `./${DB_NAME}`,
      blobUrl,
      true
    );
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
