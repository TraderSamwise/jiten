import * as fs from "fs";
import * as path from "path";
import { downloadFile, CACHE_DIR } from "./download";

export const JLPT_VOCAB_BASE_URL =
  "https://raw.githubusercontent.com/mjuhanne/yomichan-jlpt-vocab/main/data";
export const JLPT_LEVELS = [1, 2, 3, 4, 5] as const;

/** Parse a CSV line respecting quoted fields (handles commas inside quotes). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }
    if (line[i] === '"') {
      // Quoted field
      let end = i + 1;
      while (end < line.length) {
        if (line[end] === '"') {
          if (end + 1 < line.length && line[end + 1] === '"') {
            end += 2; // escaped quote
          } else {
            break;
          }
        } else {
          end++;
        }
      }
      fields.push(line.slice(i + 1, end).replace(/""/g, '"'));
      i = end + 2; // skip closing quote + comma
    } else {
      // Unquoted field
      const comma = line.indexOf(",", i);
      if (comma === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, comma));
      i = comma + 1;
    }
  }
  return fields;
}

/** Download JLPT vocab CSVs to cache directory. */
export async function downloadJlptCsvs(): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (const level of JLPT_LEVELS) {
    const csvPath = path.join(CACHE_DIR, `jlpt-n${level}.csv`);
    await downloadFile(`${JLPT_VOCAB_BASE_URL}/n${level}.csv`, csvPath);
  }
}

/**
 * Parse JLPT vocab CSVs and return a map of jmdict_seq → JLPT level.
 * Filters to origin="waller" rows and deduplicates by jmdict_seq.
 */
export function loadJlptVocab(cacheDir: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const level of JLPT_LEVELS) {
    const csvPath = path.join(cacheDir, `jlpt-n${level}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    const lines = fs.readFileSync(csvPath, "utf-8").split("\n");
    const header = parseCsvLine(lines[0] ?? "");
    const seqIdx = header.indexOf("jmdict_seq");
    const originIdx = header.indexOf("origin");
    if (seqIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCsvLine(line);
      const origin = originIdx >= 0 ? fields[originIdx] : "";
      if (originIdx >= 0 && origin !== "waller") continue;
      const seq = parseInt(fields[seqIdx], 10);
      if (!Number.isFinite(seq)) continue;
      if (!map.has(seq)) {
        map.set(seq, level);
      }
    }
  }
  return map;
}
