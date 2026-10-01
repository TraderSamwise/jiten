/**
 * Is "print the first reading JMdict lists" the right rule?
 *
 * 36,954 entries list more than one reading and the furigana pass always takes
 * the first row. That is not a guess — JMdict orders an entry's readings
 * editorially, most prevalent first — but it has never been checked against
 * usage, and the name-frequency work raised the question of whether it should
 * be ranked by frequency instead.
 *
 * The check: for every multi-reading entry, compare JMdict's first reading with
 * the reading the JPDB frequency list records for that spelling (anime, novels,
 * visual novels — the reader's actual domain). JPDB carries the dominant
 * reading of a spelling rather than competing ones, so the question it answers
 * is "is the first-listed reading the one people use", which is exactly the
 * question. Disagreements are printed to be read.
 *
 * Script variants are reported separately, because ズキズキ against ずきずき is
 * the same reading written two ways and says nothing about which to print.
 *
 * The answer, as of 2026-10-01, is that the first-listed reading stays: 97.4%
 * agreement, and the disagreements are mostly JPDB being wrong (こかくまんぞく
 * for 顧客満足, すいちょう for 水鳥). JPDB also records only ONE reading per
 * spelling, so it can never say reading B beats reading A. The reasoning is in
 * docs/reader-lookup-decisions.md under "Rejected"; this exists so the
 * conclusion can be re-checked rather than re-argued.
 *
 * Usage: yarn check:reading-order [--corpus] [--limit N]
 *
 * Needs assets/dictionary.db and the cached JPDB list (.cache/jpdb-freq.zip,
 * fetched by yarn build:jlpt), so this is a local gate, not a CI one.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { toHiragana } from "wanakana";

import { loadNovelFrequencies } from "./lib/novel-freq";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");
const CORPUS = resolve(ROOT, "test/corpus/bocchan.txt");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

interface Row {
  entry_id: number;
  spelling: string | null;
  readings: string;
}

async function main() {
  if (!existsSync(DICT)) {
    console.error(`Missing ${DICT}. Run 'yarn build:db' first.`);
    process.exit(2);
  }
  const db = new Database(DICT, { readonly: true });

  // Readings in rowid order, which is the order the furigana pass reads them.
  const rows = db
    .prepare(
      `SELECT e.id AS entry_id,
              (SELECT text FROM kanji WHERE entry_id = e.id ORDER BY rowid LIMIT 1) AS spelling,
              (SELECT group_concat(text, char(10)) FROM (
                 SELECT text FROM kana WHERE entry_id = e.id ORDER BY rowid
               )) AS readings
         FROM entries e
        WHERE e.common = 1
          AND (SELECT count(*) FROM kana WHERE entry_id = e.id) > 1`,
    )
    .all() as Row[];
  console.log(`${rows.length} common entries list more than one reading`);

  const corpusOnly = process.argv.includes("--corpus");
  let inCorpus: Set<string> | null = null;
  if (corpusOnly) {
    const text = readFileSync(CORPUS, "utf-8");
    inCorpus = new Set<string>();
    for (const row of rows)
      if (row.spelling && text.includes(row.spelling)) inCorpus.add(row.spelling);
    console.log(`  ${inCorpus.size} of their spellings appear in the corpus`);
  }

  const freq = await loadNovelFrequencies();
  // The map is flat, keyed "term\treading" alongside bare terms. Invert it so a
  // spelling's known readings can be asked for.
  const readingsOfTerm = new Map<string, { reading: string; rank: number }[]>();
  for (const [key, rank] of freq) {
    const tab = key.indexOf("\t");
    if (tab < 0) continue;
    const term = key.slice(0, tab);
    const reading = key.slice(tab + 1);
    const list = readingsOfTerm.get(term);
    if (list) list.push({ reading, rank });
    else readingsOfTerm.set(term, [{ reading, rank }]);
  }

  let compared = 0;
  let agree = 0;
  let noData = 0;
  const scriptVariants: string[] = [];
  const realDisagreements: string[] = [];

  for (const row of rows) {
    if (!row.spelling || !row.readings) continue;
    if (inCorpus && !inCorpus.has(row.spelling)) continue;
    const readings = row.readings.split("\n").filter(Boolean);
    // Only readings JMdict actually lists for this entry; JPDB attaches some
    // spellings to readings of a different entry entirely.
    const known = new Set(readings);
    const ranked = (readingsOfTerm.get(row.spelling) ?? []).filter((entry) =>
      known.has(entry.reading),
    );
    if (ranked.length === 0) {
      noData++;
      continue;
    }
    compared++;
    ranked.sort((a, b) => a.rank - b.rank);
    const first = readings[0];
    if (ranked[0].reading === first) {
      agree++;
      continue;
    }
    const line = `  ${row.spelling}\tfirst-listed ${first} (rank ${
      ranked.find((entry) => entry.reading === first)?.rank ?? "-"
    })\tmost used ${ranked[0].reading} (rank ${ranked[0].rank})`;
    // ズキズキ against ずきずき is one reading written two ways.
    if (toHiragana(first) === toHiragana(ranked[0].reading)) scriptVariants.push(line);
    else realDisagreements.push(line);
  }

  console.log(`\nComparable (JPDB records a reading JMdict lists): ${compared}`);
  console.log(`  first-listed is the most used:   ${agree} (${pct(agree, compared)})`);
  console.log(`  differ only in script:           ${scriptVariants.length}`);
  console.log(`  genuinely different reading:     ${realDisagreements.length}`);
  console.log(`Not comparable (JPDB records none of them): ${noData}`);

  const limit = Number(arg("--limit") ?? 60);
  console.log(`\nGenuine disagreements:`);
  console.log(realDisagreements.slice(0, limit).join("\n") || "  (none)");
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${((100 * part) / whole).toFixed(1)}%`;

main().catch((error) => {
  console.error("Check failed:", error);
  process.exit(1);
});
