/**
 * A bookmark list to run the highlight gates against.
 *
 * `yarn why:highlight` needs an exported list, and the reader's own is on the
 * device. This writes a stand-in: the top entries by `entries.priority`, which
 * is the dictionary's own idea of what a reader meets first, plus the entries
 * named in the open defect reports so those stay reproducible.
 *
 * It is a PROXY. It paints about a fifth of a page where the real list paints
 * a tenth, and the coverage figures in docs/reader-lookup-decisions.md were
 * taken against the real list and do not compare to it. What it is for is the
 * diff across a change.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const DICT = resolve(__dirname, "..", "assets/dictionary.db");
const OUT = resolve(__dirname, "..", ".cache/proxy-list.jiten");

/** The size of the list this stands in for, so the shape is comparable. */
const SIZE = 8586;

/**
 * Content words only. A reader saves 岩盤浴, not を — and a list of particles
 * paints two thirds of every page, which is a diff nobody can read. The tag
 * is matched quoted, because `n-suf` and `n-pref` contain the bare ones and
 * 会, 県, 市 and 週 are words.
 */
const CLASSES_NOBODY_SAVES = ["prt", "cop", "aux-v", "aux-adj", "conj", "int", "pref", "suf"];
const NOT_A_CLASS_NOBODY_SAVES = CLASSES_NOBODY_SAVES.map(
  (tag) => `s.part_of_speech NOT LIKE '%"${tag}"%'`,
).join(" AND ");
const CONTENT_WORDS = `
  SELECT id FROM entries e
   WHERE EXISTS (SELECT 1 FROM senses s WHERE s.entry_id = e.id AND ${NOT_A_CLASS_NOBODY_SAVES})
     AND NOT EXISTS (SELECT 1 FROM senses s WHERE s.entry_id = e.id
                       AND NOT (${NOT_A_CLASS_NOBODY_SAVES}))
   ORDER BY e.priority DESC, e.id ASC LIMIT ?`;

/** Entries named in docs/reader-defects-plan-v2.md, kept reachable. */
const REPORTED = [
  1008030, 1198890, 1198910, 1240530, 1276490, 1315750, 1546050, 1546070, 1579170, 2521460,
];

function main(): void {
  if (!existsSync(DICT)) {
    console.error(`Missing ${DICT}. Run yarn build:db.`);
    process.exit(2);
  }
  const db = new Database(DICT, { readonly: true });
  const rows = db.prepare(CONTENT_WORDS).all(SIZE) as { id: number }[];
  const ids = new Set<number>(rows.map((row) => row.id));
  for (const id of REPORTED) ids.add(id);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      format: "jiten-list-v2",
      list: { name: `proxy-top${SIZE}` },
      entries: [...ids].sort((a, b) => a - b).map((entryId) => ({ entryId })),
    }),
  );
  console.log(`wrote ${OUT} — ${ids.size} entries`);
}

void main();
