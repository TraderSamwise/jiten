/**
 * Tap-lookup self-consistency measurement.
 *
 * Tapping any character of a word should return the same span as tapping any
 * other character of that same word. That invariant needs no hand-labelled
 * segmentation to check: run the tap lookup at every position in real prose,
 * and for each span it returns, verify that tapping each character inside that
 * span returns the same span back. Every disagreement is a bug in the lookup,
 * because the two answers cannot both be the word under the finger.
 *
 * Disagreements are classified by shape rather than by which side is "right":
 *
 *   prefix   the shorter is the start of the longer — 受け ⊂ 受け合った.
 *            Compound verbs truncated to their first stem; longer is correct.
 *   suffix   the shorter is the end of the longer — した ⊂ 囃した.
 *   overlap  neither contains the other — ある / があ. Both are junk spans over
 *            a kana run, and no choice between them is right.
 *
 * Usage: yarn check:tap-consistency [--limit N] [--corpus path]
 *
 * Needs assets/dictionary.db and assets/dictionary-extended.db, which are built
 * artifacts and not in the repo — so this is a local gate, not a CI one.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { smartLookupWithOffset } from "../packages/japanese-reader/src/lookup";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");
const EXT = resolve(ROOT, "assets/dictionary-extended.db");

/** How much text either side of the tap the reader hands to the lookup. */
const WINDOW = 24;
const SKIP = /[\s、。「」『』（）　]/;

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
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Span {
  start: number;
  len: number;
  text: string;
}

async function main() {
  for (const db of [DICT, EXT]) {
    if (!existsSync(db)) {
      console.error(`missing ${db}\nRun the app once to download the databases, or yarn build:db.`);
      process.exit(2);
    }
  }

  const corpusPath = arg("--corpus") ?? resolve(ROOT, "test/corpus/bocchan.txt");
  const limit = Number(arg("--limit") ?? 4000);
  const text = readFileSync(corpusPath, "utf8");
  const dictDb = openDb(DICT);
  const extDb = openDb(EXT);

  const spanAt = new Map<number, Span>();
  const upTo = Math.min(text.length, limit);
  for (let i = 0; i < upTo; i++) {
    if (SKIP.test(text[i])) continue;
    const from = Math.max(0, i - WINDOW);
    const results = await smartLookupWithOffset(
      text.slice(from, i + WINDOW),
      i - from,
      dictDb,
      extDb,
    );
    if (results.length === 0) continue;
    const first = results[0];
    spanAt.set(i, {
      start: from + (first.matchStart ?? i - from),
      len: first.matchedText.length,
      text: first.matchedText,
    });
  }

  let checks = 0;
  let agree = 0;
  const pairs = new Map<string, { from: string; got: string; count: number }>();
  for (const [i, span] of spanAt) {
    for (let j = span.start; j < span.start + span.len; j++) {
      const other = spanAt.get(j);
      if (!other) continue;
      checks++;
      if (other.start === span.start && other.len === span.len) {
        agree++;
      } else if (j !== i) {
        const key = `${span.text}|${other.text}`;
        const seen = pairs.get(key);
        if (seen) seen.count++;
        else pairs.set(key, { from: span.text, got: other.text, count: 1 });
      }
    }
  }

  const shapes = { prefix: [] as string[], suffix: [] as string[], overlap: [] as string[] };
  for (const { from, got } of pairs.values()) {
    const [long, short] = from.length >= got.length ? [from, got] : [got, from];
    if (long !== short && long.startsWith(short)) shapes.prefix.push(`${short} ⊂ ${long}`);
    else if (long !== short && long.endsWith(short)) shapes.suffix.push(`${short} ⊂ ${long}`);
    else shapes.overlap.push(`${from} / ${got}`);
  }

  const pct = checks > 0 ? (agree / checks) * 100 : 100;
  const total = pairs.size || 1;
  console.log(`corpus            ${corpusPath} (${upTo} chars scanned)`);
  console.log(`taps resolved     ${spanAt.size}`);
  console.log(`pairwise checks   ${checks}`);
  console.log(`agreeing          ${agree}  (${pct.toFixed(1)}%)`);
  console.log(`\ndisagreeing pairs ${pairs.size}`);
  for (const [name, list] of Object.entries(shapes)) {
    const share = ((list.length / total) * 100).toFixed(0);
    console.log(`  ${name.padEnd(8)} ${String(list.length).padStart(3)}  (${share}%)`);
    for (const example of list.slice(0, 10)) console.log(`      ${example}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
