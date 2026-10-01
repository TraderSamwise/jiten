/**
 * Why is this span highlighted in the reader?
 *
 * Takes a surface exactly as it appears on the page and reports every
 * bookmarked entry that could have produced it, with the deinflection path
 * that got there. The highlighter resolves spans by deinflecting each
 * candidate substring and asking whether any resulting word belongs to a
 * bookmarked entry, so this reproduces that question for one span.
 *
 * Usage: yarn why:highlight --list <export.jiten> <surface> [...]
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { deinflect } from "../packages/japanese-reader/src/deinflect";

const DICT = resolve(__dirname, "..", "assets/dictionary.db");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

interface EntryRow {
  id: number;
  common: number;
  kanji: string | null;
  kana: string | null;
  gloss: string | null;
  pos: string | null;
}

/** senses.glosses is a JSON array of {lang, text}; show the English. */
function readGlosses(raw: string | null): string {
  if (!raw) return "";
  const texts: string[] = [];
  for (const match of raw.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)) texts.push(match[1]);
  return texts.slice(0, 6).join(", ");
}

/** part_of_speech is a JSON array of tags. */
function readTags(raw: string | null): string {
  if (!raw) return "";
  return [...new Set([...raw.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]))].slice(0, 6).join(",");
}

function main() {
  const listPath = arg("--list");
  if (!listPath || !existsSync(listPath)) {
    console.error("Usage: yarn why:highlight --list <export.jiten> <surface> [...]");
    process.exit(2);
  }
  if (!existsSync(DICT)) {
    console.error(`Missing ${DICT}.`);
    process.exit(2);
  }

  const exported = JSON.parse(readFileSync(listPath, "utf-8")) as {
    list?: { name?: string };
    entries: { entryId: number }[];
  };
  const bookmarked = new Set(exported.entries.map((entry) => entry.entryId));
  console.log(`${exported.list?.name ?? listPath}: ${bookmarked.size} bookmarked entries\n`);

  const db = new Database(DICT, { readonly: true });
  const lookup = db.prepare(`
    SELECT e.id, e.common,
           (SELECT group_concat(text, '/') FROM kanji WHERE entry_id = e.id) AS kanji,
           (SELECT group_concat(text, '/') FROM kana  WHERE entry_id = e.id) AS kana,
           (SELECT group_concat(glosses, '; ') FROM senses WHERE entry_id = e.id) AS gloss,
           (SELECT group_concat(part_of_speech, '/') FROM senses WHERE entry_id = e.id) AS pos
      FROM entries e
     WHERE e.id IN (SELECT entry_id FROM kanji WHERE text = ?)
        OR e.id IN (SELECT entry_id FROM kana  WHERE text = ?)`);

  const surfaces = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== listPath);
  for (const surface of surfaces) {
    console.log(`=== ${surface} ===`);
    let found = false;
    for (const { word, reasons } of deinflect(surface)) {
      for (const row of lookup.all(word, word) as EntryRow[]) {
        if (!bookmarked.has(row.id)) continue;
        found = true;
        console.log(
          `  entry ${row.id}  ${row.kanji ?? "(no kanji)"} [${row.kana}]${row.common ? "  common" : ""}`,
        );
        console.log(
          `    matched "${word}"${reasons.length ? ` via ${reasons.join(" < ")}` : " as written"}` +
            `; entry written in kanji: ${row.kanji ? "yes" : "no"}`,
        );
        console.log(`    pos ${readTags(row.pos)} — ${readGlosses(row.gloss)}`);
      }
    }
    if (!found) console.log("  nothing bookmarked matches this surface");
    console.log();
  }
}

main();
