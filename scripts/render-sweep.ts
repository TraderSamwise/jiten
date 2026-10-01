/**
 * Furigana RENDER sweep.
 *
 * `yarn sweep:furigana` resolves readings; it cannot see a change to
 * `applyFuriganaToHtml`, which is what turns those readings into ruby. So a
 * change to the renderer is measured here instead: the whole corpus is
 * rendered page-sized chunk by chunk and each chunk's HTML is hashed, before
 * and after, and the hashes are diffed.
 *
 * This is how the pinned-reading pass was shown to change nothing when no
 * reading is pinned.
 *
 *   yarn sweep:render --out before.txt
 *   (make the change)
 *   yarn sweep:render --diff before.txt
 *
 * Needs assets/dictionary.db and assets/dictionary-extended.db, which are
 * built artifacts and not in the repo — so this is a local gate, not a CI one.
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";
import {
  applyFuriganaToHtml,
  extractSurfacesFromHtml,
  resolveFuriganaBatch,
  type FuriganaEntry,
} from "../packages/japanese-reader/src/furigana";
import type {
  FuriganaMatchLevel,
  ReaderFuriganaSettings,
} from "../packages/japanese-reader/src/furigana-types";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");
const EXT = resolve(ROOT, "assets/dictionary-extended.db");
const CORPUS = resolve(ROOT, "test/corpus/bocchan.txt");

/** About a page of vertical text, so a chunk is the unit the reader renders. */
const CHUNK = 400;

function openDb(path: string): ReaderSqlDb {
  const db = new Database(path, { readonly: true });
  return {
    getAllAsync: async <T>(sql: string, params?: unknown[]) =>
      (params ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as T[],
    getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
      ((params ? db.prepare(sql).get(...(params as never[])) : db.prepare(sql).get()) as T) ?? null,
  };
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const allLevels: Record<FuriganaMatchLevel, boolean> = {
  n5: true,
  n4: true,
  n3: true,
  n2: true,
  n1: true,
  nonJouyou: true,
};
/**
 * Every rule on at every level, names and counters off.
 *
 * Both halves matter. The rules on give the sweep as much ruby as the renderer
 * will ever emit; names and counters off are what make the renderer REJECT
 * surfaces, and a rejected surface shadows the characters behind it — the
 * exact path a change to this file is most likely to disturb.
 */
const SETTINGS: ReaderFuriganaSettings = {
  sourceDefault: true,
  showNames: false,
  showCounters: false,
  ruleLevels: {
    matchAnyKanji: { ...allLevels },
    matchWordLevel: { ...allLevels },
    matchIrregularReading: { ...allLevels },
    matchMostlyKunyomi: { ...allLevels },
    matchMostlyOnyomi: { ...allLevels },
    matchMixedOnKun: { ...allLevels },
  },
};

async function main(): Promise<void> {
  for (const path of [DICT, EXT, CORPUS]) {
    if (!existsSync(path)) {
      console.error(`missing ${path}`);
      process.exit(1);
    }
  }

  const dict = openDb(DICT);
  const ext = openDb(EXT);
  const corpus = readFileSync(CORPUS, "utf8");
  const kanjiSet = { all: true, chars: new Set<string>() };

  const chunks: string[] = [];
  for (let at = 0; at < corpus.length; at += CHUNK) {
    const piece = corpus.slice(at, at + CHUNK).trim();
    if (piece.length > 0) chunks.push(piece);
  }

  const lines: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const html = `<p>${chunks[i]}</p>`;
    const surfaces = extractSurfacesFromHtml(html, kanjiSet);
    const resolved = await resolveFuriganaBatch(surfaces, dict, ext);
    const map = new Map<string, FuriganaEntry>(Object.entries(resolved));
    const out = applyFuriganaToHtml(html, map, kanjiSet, SETTINGS);
    lines.push(`${i}\t${createHash("sha1").update(out).digest("hex")}\t${out.length}`);
  }

  const outPath = arg("--out");
  if (outPath) {
    writeFileSync(outPath, lines.join("\n"));
    console.log(`wrote ${lines.length} chunk hashes to ${outPath}`);
    return;
  }

  const diffPath = arg("--diff");
  if (!diffPath || !existsSync(diffPath)) {
    console.error("need --out <file> or --diff <file>");
    process.exit(1);
  }
  const before = readFileSync(diffPath, "utf8").split("\n");
  let changed = 0;
  for (let i = 0; i < Math.max(before.length, lines.length); i++) {
    if (before[i] === lines[i]) continue;
    changed++;
    if (changed <= 10) console.log(`chunk ${i}\n  before ${before[i]}\n  after  ${lines[i]}`);
  }
  console.log(`${changed} of ${lines.length} chunks changed`);
}

void main();
