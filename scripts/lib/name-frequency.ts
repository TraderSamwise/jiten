/**
 * Reads data/name-frequency.tsv, built by scripts/build-name-frequency.ts.
 *
 * Its own module rather than part of the build script because importing that
 * script pulls in node-wordnet, which pulls in es6-shim, which REPLACES the
 * global Promise with one that has no .finally — enough to kill a whole vitest
 * run at collection.
 */

import * as fs from "fs";
import * as path from "path";

export const NAME_FREQ_PATH = path.resolve(__dirname, "..", "..", "data", "name-frequency.tsv");

/**
 * A missing or empty file is fatal rather than a quiet NULL column: a
 * dictionary that silently ships no frequencies reads 杏子 as あんず again and
 * nothing about the build says why.
 */
export function loadNameFrequencies(filePath: string = NAME_FREQ_PATH): Map<string, number> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Run 'yarn build:name-freq' first — it derives ` +
        `the name reading counts that rank furigana for names.`,
    );
  }
  const counts = new Map<string, number>();
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    if (line.length === 0 || line.startsWith("#")) continue;
    const [kanji, kana, count] = line.split("\t");
    const n = Number(count);
    if (!kanji || !kana || !Number.isInteger(n) || n <= 0) {
      throw new Error(`Malformed line in ${filePath}: ${JSON.stringify(line)}`);
    }
    counts.set(`${kanji}\t${kana}`, n);
  }
  if (counts.size === 0) throw new Error(`${filePath} holds no counts`);
  return counts;
}
