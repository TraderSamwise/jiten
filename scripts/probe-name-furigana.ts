/**
 * Resolve furigana and tap lookup for the name cases this work turns on.
 *
 * The corpus sweep bounds collateral damage but cannot prove the fix: 杏子 is a
 * character in a novel nobody's test corpus contains. This asks the shipping
 * code about the exact surfaces, against the real built dictionaries.
 *
 * Usage: yarn probe:names [surface ...]
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { resolve } from "path";

import { resolveFuriganaBatch } from "../packages/japanese-reader/src/furigana";
import { lookupExactName } from "../packages/japanese-reader/src/lookup-db";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");
const EXT = resolve(ROOT, "assets/dictionary-extended.db");

/** 杏子 is the target; the rest must not move. */
const DEFAULT_SURFACES = ["杏子", "後味", "高遠", "五十嵐", "京子", "洋子", "一郎", "四十三"];

function openDb(path: string): ReaderSqlDb {
  const db = new Database(path, { readonly: true });
  return {
    getAllAsync: async <T>(sql: string, params?: unknown[]) =>
      (params ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as T[],
    getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
      ((params ? db.prepare(sql).get(...(params as never[])) : db.prepare(sql).get()) as T) ?? null,
  };
}

async function main() {
  for (const [path, what] of [
    [DICT, "assets/dictionary.db"],
    [EXT, "assets/dictionary-extended.db"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`Missing ${what}.`);
      process.exit(2);
    }
  }
  const surfaces = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const probes = surfaces.length > 0 ? surfaces : DEFAULT_SURFACES;

  const dictDb = openDb(DICT);
  const extDb = openDb(EXT);
  const furigana = await resolveFuriganaBatch(probes, dictDb, extDb);

  for (const surface of probes) {
    const entry = furigana[surface];
    const names = await lookupExactName(extDb, surface);
    const shown = entry
      ? `${entry.reading}${entry.isName ? " [name]" : ""}${entry.isCounter ? " [counter]" : ""}`
      : "(no furigana)";
    const tap = names
      .slice(0, 3)
      .map((name) => name.kana)
      .join(", ");
    console.log(`${surface}\tfurigana: ${shown}\ttap: ${tap || "(no name)"}`);
  }
}

main().catch((error) => {
  console.error("Probe failed:", error);
  process.exit(1);
});
