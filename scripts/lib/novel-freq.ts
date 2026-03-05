/**
 * Parse a Yomitan-format frequency dictionary (JPDB frequency list)
 * and match entries to JMdict entry IDs.
 *
 * The JPDB frequency list is based on a large corpus of anime, novels, and other media.
 * It provides a good secondary signal for word frequency, especially for literary Japanese.
 *
 * Yomitan frequency dict format: zip containing term_meta_bank_*.json files.
 * Each file is a JSON array of entries: [term, "freq", {frequency: N, reading?: string}] or [term, "freq", N]
 */

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import { downloadFile, CACHE_DIR } from "./download";

const JPDB_FREQ_URL =
  "https://github.com/MarvNC/jpdb-freq-list/releases/download/2022-05-09/Freq.JPDB_2022-05-10T03_27_02.930Z.zip";

interface FreqEntry {
  term: string;
  reading?: string;
  frequency: number;
}

/**
 * Download and parse the JPDB frequency dictionary.
 * Returns a map of "kanji|reading" or just "term" → frequency rank.
 */
export async function loadNovelFrequencies(): Promise<Map<string, number>> {
  const zipPath = path.join(CACHE_DIR, "jpdb-freq.zip");
  await downloadFile(JPDB_FREQ_URL, zipPath);

  console.log("  Parsing JPDB frequency dictionary...");
  const zip = new AdmZip(zipPath);
  const entries: FreqEntry[] = [];

  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith("term_meta_bank_") || !entry.entryName.endsWith(".json")) {
      continue;
    }

    const data = JSON.parse(entry.getData().toString("utf-8")) as unknown[];
    for (const item of data) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const [term, type, freqData] = item;
      if (type !== "freq" || typeof term !== "string") continue;

      let frequency: number;
      let reading: string | undefined;

      if (typeof freqData === "number") {
        frequency = freqData;
      } else if (freqData && typeof freqData === "object") {
        const obj = freqData as Record<string, unknown>;
        // Handle various Yomitan frequency formats
        if (typeof obj.frequency === "number") {
          frequency = obj.frequency;
        } else if (typeof obj.value === "number") {
          frequency = obj.value;
        } else if (
          typeof obj.frequency === "object" &&
          obj.frequency !== null &&
          typeof (obj.frequency as Record<string, unknown>).value === "number"
        ) {
          frequency = (obj.frequency as Record<string, unknown>).value as number;
        } else {
          continue;
        }
        if (typeof obj.reading === "string") {
          reading = obj.reading;
        }
      } else {
        continue;
      }

      entries.push({ term, reading, frequency });
    }
  }

  // Build lookup map: term → best (lowest) rank
  // Use "term\treading" as key when reading is available, plus always "term" as fallback key
  const freqMap = new Map<string, number>();

  for (const e of entries) {
    // Key with reading for precise matching
    if (e.reading) {
      const key = `${e.term}\t${e.reading}`;
      const existing = freqMap.get(key);
      if (!existing || e.frequency < existing) {
        freqMap.set(key, e.frequency);
      }
    }
    // Also store by term alone for fallback matching
    const existing = freqMap.get(e.term);
    if (!existing || e.frequency < existing) {
      freqMap.set(e.term, e.frequency);
    }
  }

  console.log(`  ${entries.length} frequency entries parsed, ${freqMap.size} unique terms`);
  return freqMap;
}

/**
 * Match JPDB frequency data to JMdict entry IDs.
 * Takes JMdict data (id → {kanji[], kana[]}) and JPDB frequencies.
 * Returns a map of entryId → best frequency rank.
 */
export function matchNovelFrequencies(
  jmdictEntries: Map<number, { kanji: string[]; kana: string[] }>,
  jpdbFreq: Map<string, number>,
): Map<number, number> {
  const result = new Map<number, number>();

  for (const [entryId, entry] of jmdictEntries) {
    let bestRank = Infinity;

    // Try kanji+kana combinations first (most precise)
    for (const kanji of entry.kanji) {
      for (const kana of entry.kana) {
        const rank = jpdbFreq.get(`${kanji}\t${kana}`);
        if (rank != null && rank < bestRank) bestRank = rank;
      }
      // Fallback: just kanji
      const rank = jpdbFreq.get(kanji);
      if (rank != null && rank < bestRank) bestRank = rank;
    }

    // Fallback: just kana (for kana-only words)
    if (entry.kanji.length === 0) {
      for (const kana of entry.kana) {
        const rank = jpdbFreq.get(kana);
        if (rank != null && rank < bestRank) bestRank = rank;
      }
    }

    if (bestRank < Infinity) {
      result.set(entryId, bestRank);
    }
  }

  return result;
}
