/**
 * Furigana resolution sweep.
 *
 * Furigana is deterministic given the built dictionaries, so a change to the
 * scoring is not argued about — it is resolved over every kanji-initial
 * substring of real prose, before and after, and the two runs are diffed.
 * Every entry in that diff is then read: an improvement, neutral, or a
 * regression named and accepted in docs/reader-lookup-decisions.md.
 *
 * This is the method docs/reader-lookup-decisions.md describes. It lived in a
 * throwaway script until the name-frequency work needed it twice.
 *
 * Usage:
 *   yarn sweep:furigana --out before.json
 *   (make the change)
 *   yarn sweep:furigana --out after.json
 *   yarn sweep:furigana --diff before.json after.json
 *
 * Needs assets/dictionary.db and assets/dictionary-extended.db, which are
 * built artifacts and not in the repo — so this is a local gate, not a CI one.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import { resolveFuriganaBatch } from "../packages/japanese-reader/src/furigana";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");
const EXT = resolve(ROOT, "assets/dictionary-extended.db");
const CORPUS = resolve(ROOT, "test/corpus/bocchan.txt");

/** The longest surface the reader ever asks about in one piece. */
const MAX_SURFACE = 8;
const BATCH = 2000;

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

const isKanji = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)
  );
};

/** Every kanji-initial substring of the corpus up to MAX_SURFACE characters. */
function corpusSurfaces(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const chars = [...line];
    for (let at = 0; at < chars.length; at++) {
      if (!isKanji(chars[at])) continue;
      for (let len = 1; len <= MAX_SURFACE && at + len <= chars.length; len++) {
        found.add(chars.slice(at, at + len).join(""));
      }
    }
  }
  return [...found].sort();
}

/** One line per surface, so a diff reads as text rather than as JSON. */
const render = (entry: { reading?: string; isName?: boolean; isCounter?: boolean } | undefined) =>
  entry === undefined
    ? "-"
    : `${entry.reading ?? ""}${entry.isName ? " [name]" : ""}${entry.isCounter ? " [counter]" : ""}`;

async function sweep(out: string) {
  for (const [path, what] of [
    [DICT, "assets/dictionary.db"],
    [EXT, "assets/dictionary-extended.db"],
    [CORPUS, "test/corpus/bocchan.txt"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`Missing ${what} — the sweep needs the built dictionaries.`);
      process.exit(2);
    }
  }

  const surfaces = corpusSurfaces(readFileSync(CORPUS, "utf-8"));
  console.log(`${surfaces.length} kanji-initial surfaces up to ${MAX_SURFACE} characters`);

  const dictDb = openDb(DICT);
  const extDb = openDb(EXT);
  const result: Record<string, string> = {};
  for (let at = 0; at < surfaces.length; at += BATCH) {
    const batch = surfaces.slice(at, at + BATCH);
    const resolved = await resolveFuriganaBatch(batch, dictDb, extDb);
    for (const surface of batch) result[surface] = render(resolved[surface]);
    process.stdout.write(`\r  ${Math.min(at + BATCH, surfaces.length)}/${surfaces.length}   `);
  }
  process.stdout.write("\n");

  writeFileSync(out, `${JSON.stringify(result, null, 0)}\n`);
  const annotated = Object.values(result).filter((line) => line !== "-").length;
  console.log(`Wrote ${out}: ${annotated} of ${surfaces.length} surfaces annotated`);
}

function diff(beforePath: string, afterPath: string) {
  const before = JSON.parse(readFileSync(beforePath, "utf-8")) as Record<string, string>;
  const after = JSON.parse(readFileSync(afterPath, "utf-8")) as Record<string, string>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  let changed = 0;
  let gained = 0;
  let lost = 0;
  const lines: string[] = [];
  for (const key of keys) {
    const was = before[key] ?? "-";
    const now = after[key] ?? "-";
    if (was === now) continue;
    changed++;
    if (was === "-") gained++;
    else if (now === "-") lost++;
    lines.push(`${key}\t${was}\t→\t${now}`);
  }
  console.log(lines.join("\n"));
  console.log(
    `\n${changed} of ${keys.length} surfaces changed — ${gained} gained a reading, ` +
      `${lost} lost one, ${changed - gained - lost} read differently.`,
  );
}

async function main() {
  const diffArgs = process.argv.indexOf("--diff");
  if (diffArgs >= 0) {
    const [before, after] = process.argv.slice(diffArgs + 1, diffArgs + 3);
    if (!before || !after) {
      console.error("Usage: yarn sweep:furigana --diff <before.json> <after.json>");
      process.exit(2);
    }
    diff(before, after);
    return;
  }
  const out = arg("--out");
  if (!out) {
    console.error("Usage: yarn sweep:furigana --out <file.json>");
    process.exit(2);
  }
  await sweep(out);
}

main().catch((error) => {
  console.error("Sweep failed:", error);
  process.exit(1);
});
