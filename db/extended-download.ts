/**
 * Extended data download and import engine.
 *
 * Downloads compressed JSONL files, decompresses with fflate,
 * parses line-by-line, and batch-inserts into the local extended DB.
 * Tracks progress for resumability across app restarts.
 */

import type { SQLiteDatabase } from "expo-sqlite";
import { gunzipSync } from "fflate";
import {
  isDatasetReady,
  getImportProgress,
  getDatasetVersion,
  resetDataset,
  buildIndexes,
} from "./extended-db";

const BATCH_SIZE = 2000;

export interface DatasetConfig {
  key: string;
  insertSql: string;
  parseLine: (line: string) => unknown[];
}

export const DATASET_CONFIGS: Record<string, DatasetConfig> = {
  synonyms: {
    key: "synonyms",
    insertSql: "INSERT INTO synonyms (word, synonym) VALUES (?, ?)",
    parseLine: (line: string) => {
      const { w, s } = JSON.parse(line);
      return [w, s];
    },
  },
  names: {
    key: "names",
    insertSql:
      "INSERT OR REPLACE INTO names (id, kanji, kana, name_type, translation, category) VALUES (?, ?, ?, ?, ?, ?)",
    parseLine: (line: string) => {
      const obj = JSON.parse(line);
      const nameType: string = obj.t || "";
      let category = "other";
      if (/\b(surname|fem|masc|given|person)\b/.test(nameType)) {
        category = "person";
      } else if (/\b(place|station)\b/.test(nameType)) {
        category = "place";
      }
      return [
        obj.id,
        obj.k ? obj.k.join(", ") : null,
        obj.r.join(", "),
        obj.t || null,
        obj.tr || null,
        category,
      ];
    },
  },
};

/**
 * Import a dataset from a compressed JSONL URL into the extended DB.
 * Supports resume — skips already-imported rows on restart.
 */
export async function importDataset(opts: {
  db: SQLiteDatabase;
  config: DatasetConfig;
  url: string;
  expectedRowCount: number;
  version: number;
  onProgress?: (imported: number, total: number) => void;
}): Promise<void> {
  const { db, config, url, expectedRowCount, version, onProgress } = opts;

  // Check if already complete
  if (await isDatasetReady(db, config.key, version)) {
    onProgress?.(expectedRowCount, expectedRowCount);
    return;
  }

  // Check for version mismatch — reset if needed
  const storedVersion = await getDatasetVersion(db, config.key);
  if (storedVersion > 0 && storedVersion !== version) {
    console.log(
      `[Extended] ${config.key}: version mismatch (${storedVersion} vs ${version}), resetting`,
    );
    await resetDataset(db, config.key);
  }

  // Get existing progress
  const existingRows = await getImportProgress(db, config.key);
  if (existingRows > 0) {
    console.log(`[Extended] ${config.key}: resuming from row ${existingRows}`);
  }

  // Download compressed JSONL
  console.log(`[Extended] ${config.key}: downloading from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const compressed = new Uint8Array(await res.arrayBuffer());

  // Decompress
  console.log(`[Extended] ${config.key}: decompressing ${compressed.length} bytes`);
  const decompressed = gunzipSync(compressed);
  const text = new TextDecoder().decode(decompressed);
  const lines = text.split("\n").filter((l) => l.length > 0);
  console.log(`[Extended] ${config.key}: ${lines.length} lines`);

  // Skip already-imported lines
  let imported = existingRows;
  const startIdx = existingRows;

  if (startIdx >= lines.length) {
    // All rows already imported, just finalize
    await finalizeDataset(db, config.key, version, lines.length);
    onProgress?.(lines.length, expectedRowCount);
    return;
  }

  onProgress?.(imported, expectedRowCount);

  // Batch-insert remaining lines
  for (let i = startIdx; i < lines.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, lines.length);
    const batch = lines.slice(i, batchEnd);

    await db.withTransactionAsync(async () => {
      for (const line of batch) {
        const params = config.parseLine(line);
        await db.runAsync(config.insertSql, params as any[]);
      }
    });

    imported = batchEnd;

    // Save progress (outside transaction for safety)
    await db.runAsync("INSERT OR REPLACE INTO ext_meta (key, value) VALUES (?, ?)", [
      `${config.key}_rows_imported`,
      String(imported),
    ]);

    onProgress?.(imported, expectedRowCount);
  }

  // Finalize: build indexes and mark version
  await finalizeDataset(db, config.key, version, imported);
}

async function finalizeDataset(
  db: SQLiteDatabase,
  key: string,
  version: number,
  rowCount: number,
): Promise<void> {
  console.log(`[Extended] ${key}: building indexes...`);
  await buildIndexes(db, key);

  await db.runAsync("INSERT OR REPLACE INTO ext_meta (key, value) VALUES (?, ?)", [
    `${key}_version`,
    String(version),
  ]);
  await db.runAsync("INSERT OR REPLACE INTO ext_meta (key, value) VALUES (?, ?)", [
    `${key}_rows_imported`,
    String(rowCount),
  ]);

  console.log(`[Extended] ${key}: complete (${rowCount} rows, version ${version})`);
}
