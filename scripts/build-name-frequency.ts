/**
 * Build script: derives how often a Japanese name spelling is actually read a
 * given way, and writes data/name-frequency.tsv.
 *
 * JMnedict lists every reading a spelling has ever taken and ranks none of
 * them, so 杏子 offers thirteen and the reader picks whichever row SQLite
 * returns first. The counts here break that tie with evidence: real people and
 * characters, counted once each.
 *
 * Nothing about the corpus ships. The output is `kanji \t kana \t count` and
 * goes into a `name_freq` column at dictionary build time.
 *
 * Usage: yarn build:name-freq [--refresh]
 *
 * Needs assets/dictionary-extended.db, because a (spelling, reading) pair is
 * only counted when JMnedict already lists it — the counts rank readings that
 * exist and never invent one.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

const ROOT = resolve(__dirname, "..");
const EXT_DB = resolve(ROOT, "assets/dictionary-extended.db");
const OUT = resolve(ROOT, "data/name-frequency.tsv");
const CACHE = resolve(ROOT, ".cache/name-freq");

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "jiten-name-frequency/1.0 (https://github.com/TraderSamwise/jiten)";

/** Readings are only ever counted against a spelling JMnedict already has. */
type HasNameReading = (kanji: string, kana: string) => boolean;

// ─── SPARQL ───

/**
 * The person set, shared by the count, the shard enumeration and every shard,
 * so the three can be compared to each other and a short fetch is detectable.
 */
const PEOPLE_WHERE = `?h wdt:P31 wd:Q5 ; wdt:P1814 ?kana ; rdfs:label ?l .
  FILTER(LANG(?l) = "ja")`;

/**
 * P31 wd:Q5 is "human" and excludes every character in every novel, which is
 * the case this exists for — 杏子 is one.
 */
const FICTION_WHERE = `?h wdt:P31/wdt:P279* wd:Q95074 ; wdt:P1814 ?kana ; rdfs:label ?l .
  FILTER(LANG(?l) = "ja")`;

interface SparqlRow {
  [column: string]: string;
}

async function sparql(query: string, label: string, refresh: boolean): Promise<SparqlRow[]> {
  const cached = join(CACHE, `${label}.tsv`);
  if (!refresh && existsSync(cached)) return parseTsv(readFileSync(cached, "utf-8"));

  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    let body: string;
    let type: string;
    try {
      const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: "text/tab-separated-values", "User-Agent": USER_AGENT },
      });
      type = response.headers.get("content-type") ?? "";
      body = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status} ${body.slice(0, 200)}`;
        if (response.status < 500 && response.status !== 429) break;
        await sleep(attempt * 5000);
        continue;
      }
    } catch (error) {
      lastError = String(error);
      await sleep(attempt * 5000);
      continue;
    }

    // A timed-out query answers 200 with an HTML error page. Taking that as
    // zero rows is how an incomplete fetch becomes plausible-looking data.
    if (!type.includes("text/tab-separated-values")) {
      lastError = `expected TSV, got ${type || "no content-type"}: ${body.slice(0, 200)}`;
      await sleep(attempt * 5000);
      continue;
    }

    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, body);
    return parseTsv(body);
  }
  throw new Error(`SPARQL query "${label}" failed after 4 attempts: ${lastError}`);
}

/** Wikidata TSV quotes every literal and suffixes a language tag. */
export function parseTsv(text: string): SparqlRow[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("empty SPARQL response, not even a header row");
  const header = lines[0].split("\t").map((name) => name.replace(/^\?/, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: SparqlRow = {};
    header.forEach((name, i) => (row[name] = unquote(cells[i] ?? "")));
    return row;
  });
}

function unquote(cell: string): string {
  return cell
    .replace(/^"/, "")
    .replace(/"(@[\w-]+)?$/, "")
    .replace(/\\"/g, '"')
    .trim();
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Fetches a row set too large for one query by splitting on the first
 * character of the reading.
 *
 * The shard keys are asked for rather than assumed — a hardcoded kana list
 * silently drops katakana, ー and Latin initials — and the shard total is
 * checked against a plain count of the same set, so a short fetch is an error
 * instead of a smaller number.
 */
async function fetchSharded(where: string, label: string, refresh: boolean): Promise<SparqlRow[]> {
  const expected = await expectedRows(`{ ${where} }`, `${label}-count`, refresh);
  const initials = (
    await sparql(
      `SELECT DISTINCT (SUBSTR(?kana, 1, 1) AS ?c) WHERE { ${where} }`,
      `${label}-initials`,
      refresh,
    )
  )
    .map((row) => row.c)
    .filter((c) => c.length > 0);
  console.log(`  ${label}: ${expected} rows across ${initials.length} reading initials`);

  const rows: SparqlRow[] = [];
  for (const [i, initial] of initials.entries()) {
    const shard = await fetchShard(where, label, initial, refresh);
    rows.push(...shard);
    process.stdout.write(`\r  shard ${i + 1}/${initials.length} (${rows.length} rows)   `);
  }
  process.stdout.write("\n");

  assertComplete(label, rows.length, expected);
  return rows;
}

/**
 * How many rows the endpoint says the pattern has.
 *
 * Every fetch is checked against this. Wikidata streams its TSV, so a query
 * that times out mid-stream answers 200 with the right content type and fewer
 * rows — indistinguishable from real data, and the counts it produces look
 * entirely plausible.
 */
async function expectedRows(pattern: string, label: string, refresh: boolean): Promise<number> {
  const [row] = await sparql(`SELECT (COUNT(*) AS ?n) WHERE ${pattern}`, label, refresh);
  const n = Number(row?.n);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label}: expected a row count, got ${JSON.stringify(row?.n)}`);
  }
  return n;
}

function assertComplete(label: string, got: number, expected: number) {
  if (got === expected) return;
  throw new Error(
    `${label}: fetched ${got} rows but the endpoint counts ${expected}. ` +
      `Refusing to derive counts from an incomplete fetch — rerun with --refresh.`,
  );
}

/** An unsharded query, with the same completeness check. */
async function fetchChecked(
  select: string,
  pattern: string,
  label: string,
  refresh: boolean,
): Promise<SparqlRow[]> {
  const expected = await expectedRows(pattern, `${label}-count`, refresh);
  const rows = await sparql(`${select} WHERE ${pattern}`, label, refresh);
  assertComplete(label, rows.length, expected);
  return rows;
}

/**
 * One shard, sub-sharded on the second character if the whole one times out.
 * The common initials are big enough that this happens.
 */
async function fetchShard(
  where: string,
  label: string,
  initial: string,
  refresh: boolean,
): Promise<SparqlRow[]> {
  const key = `${label}-${codepoints(initial)}`;
  const select = (filter: string) =>
    `SELECT ?l ?kana WHERE { ${where} FILTER(STRSTARTS(?kana, "${initial}")) ${filter} }`;
  try {
    return await sparql(select(""), key, refresh);
  } catch (error) {
    console.warn(`\n  ${initial}: ${String(error).slice(0, 120)} — splitting`);
  }

  const seconds = [
    ...new Set(
      (
        await sparql(
          `SELECT DISTINCT (SUBSTR(?kana, 2, 1) AS ?c) WHERE { ${where} FILTER(STRSTARTS(?kana, "${initial}")) }`,
          `${key}-seconds`,
          refresh,
        )
      ).map((row) => row.c),
    ),
  ];
  const rows: SparqlRow[] = [];
  for (const second of seconds) {
    const filter =
      second.length === 0
        ? `FILTER(STRLEN(?kana) = 1)`
        : `FILTER(STRSTARTS(?kana, "${initial}${second}"))`;
    rows.push(...(await sparql(select(filter), `${key}-${codepoints(second)}`, refresh)));
  }
  return rows;
}

/** Cache keys by codepoint: two distinct terms can print the same character. */
const codepoints = (text: string) =>
  [...text].map((c) => c.codePointAt(0)!.toString(16)).join("-") || "empty";

// ─── Splitting a whole-name reading ───

const KANA = /^[ぁ-ゟァ-ヿー]+$/;

export type SplitOutcome =
  | { kind: "pair"; pairs: [string, string][] }
  | { kind: "mono"; pairs: [string, string][] }
  | { kind: "no-split" }
  | { kind: "ambiguous" }
  | { kind: "malformed" };

/**
 * Turns one Wikidata row into the (spelling, reading) pairs it supports.
 *
 * P1814 is the whole name spaced into its parts (まつやま ちはる) against a
 * label that may not be (松山千春), so the kanji boundary has to be found. It
 * is found by checking candidates against JMnedict rather than guessed: a
 * split counts only when the table already holds both halves with those exact
 * readings. That cannot invent a reading, and it drops pen names for free —
 * 石崎 寿夫 read すしお splits nowhere.
 *
 * Several consistent splits means the row cannot say which is right (泉美幸 is
 * 泉|美幸 or 泉美|幸, both いずみ みゆき), so it says nothing.
 */
export function splitNameRow(label: string, kana: string, has: HasNameReading): SplitOutcome {
  const spelling = label.replace(/[\s　]+/g, "");
  const parts = kana.split(/[\s　]+/).filter((part) => part.length > 0);
  if (spelling.length === 0 || parts.length === 0) return { kind: "malformed" };
  if (parts.some((part) => !KANA.test(part))) return { kind: "malformed" };

  if (parts.length === 1) {
    if (!has(spelling, parts[0])) return { kind: "malformed" };
    return { kind: "mono", pairs: [[spelling, parts[0]]] };
  }
  if (parts.length !== 2) return { kind: "malformed" };

  const [first, second] = parts;
  const chars = [...spelling];
  const consistent: [string, string][][] = [];
  for (let at = 1; at < chars.length; at++) {
    const head = chars.slice(0, at).join("");
    const tail = chars.slice(at).join("");
    if (has(head, first) && has(tail, second)) {
      consistent.push([
        [head, first],
        [tail, second],
      ]);
    }
  }
  if (consistent.length === 1) return { kind: "pair", pairs: consistent[0] };
  if (consistent.length > 1) return { kind: "ambiguous" };
  return { kind: "no-split" };
}

// ─── Main ───

function loadNameReadings(): { has: HasNameReading; readingsOf: Map<string, Set<string>> } {
  if (!existsSync(EXT_DB)) {
    console.error(`Missing ${EXT_DB}`);
    console.error("Run 'yarn build:extended' first — the counts validate against it.");
    process.exit(2);
  }
  const db = new Database(EXT_DB, { readonly: true });
  // category='person' is set at build time from the same name_type test, and
  // it is indexed. Rows with no kanji cannot be a spelling.
  const rows = db
    .prepare(
      "SELECT kanji, kana FROM names WHERE category = 'person' AND kanji IS NOT NULL AND kanji <> ''",
    )
    .all() as { kanji: string; kana: string }[];
  db.close();

  // A handful of entries list several spellings or readings in one cell,
  // joined with ", ". Splitting them keeps this side symmetric with the build,
  // which looks each form up separately before the join.
  const readingsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const kanji of row.kanji.split(", ")) {
      if (kanji.length === 0) continue;
      let readings = readingsOf.get(kanji);
      if (!readings) readingsOf.set(kanji, (readings = new Set()));
      for (const kana of row.kana.split(", ")) readings.add(kana);
    }
  }
  console.log(`  ${rows.length} person rows, ${readingsOf.size} distinct spellings`);
  return { has: (kanji, kana) => readingsOf.get(kanji)?.has(kana) ?? false, readingsOf };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  console.log("=== Name reading frequency ===\n");
  console.log("Reading JMnedict names...");
  const { has, readingsOf } = loadNameReadings();

  console.log("\nFetching Wikidata...");
  const people = await fetchSharded(PEOPLE_WHERE, "people", refresh);
  const fiction = await fetchChecked("SELECT ?l ?kana", `{ ${FICTION_WHERE} }`, "fiction", refresh);
  console.log(`  fiction: ${fiction.length} rows`);

  const counts = new Map<string, number>();
  const add = (kanji: string, kana: string, by: number) =>
    counts.set(`${kanji}\t${kana}`, (counts.get(`${kanji}\t${kana}`) ?? 0) + by);

  // Every row counts, with no dedupe on the name.
  //
  // Two people really can be called 田中洋子, and collapsing them would
  // suppress exactly the readings common enough to have namesakes — the
  // opposite of what is being measured. Deduping on the Wikidata entity
  // instead would be strictly right, but selecting ?h triples the payload and
  // the large shards stop coming back. Duplicate items for one person are
  // rarer than shared names and fall on no particular reading, so they stay.
  const tally = { pair: 0, mono: 0, "no-split": 0, ambiguous: 0, malformed: 0 };
  for (const row of [...people, ...fiction]) {
    const outcome = splitNameRow(row.l, row.kana, has);
    tally[outcome.kind]++;
    if (outcome.kind === "pair" || outcome.kind === "mono") {
      for (const [kanji, kana] of outcome.pairs) add(kanji, kana, 1);
    }
  }

  // Given- and family-name items carry the component directly, so these need
  // no split at all and recover spellings the split cannot reach.
  let direct = 0;
  for (const property of ["P735", "P734"]) {
    const pattern = `{
        ?h wdt:P31 wd:Q5 ; wdt:${property} ?gn .
        ?gn rdfs:label ?gl ; wdt:P1814 ?gkana .
        FILTER(LANG(?gl) = "ja")
      }`;
    // The grouped query returns one row per distinct pair, so the count it is
    // checked against has to count pairs too, not the people behind them.
    const expected = await expectedRows(
      `{ SELECT DISTINCT ?gl ?gkana WHERE ${pattern} }`,
      `name-items-${property}-count`,
      refresh,
    );
    const rows = await sparql(
      `SELECT ?gl ?gkana (COUNT(DISTINCT ?h) AS ?c) WHERE ${pattern} GROUP BY ?gl ?gkana`,
      `name-items-${property}`,
      refresh,
    );
    assertComplete(`name-items-${property}`, rows.length, expected);
    console.log(`  ${property}: ${rows.length} rows`);
    for (const row of rows) {
      const kanji = row.gl.replace(/[\s　]+/g, "");
      const by = Number(row.c);
      if (!KANA.test(row.gkana) || !Number.isFinite(by) || by <= 0) continue;
      if (!has(kanji, row.gkana)) continue;
      add(kanji, row.gkana, by);
      direct++;
    }
  }

  const rowsIn = people.length + fiction.length;
  console.log(`\nRows in: ${rowsIn}`);
  console.log(`  split uniquely       ${tally.pair}`);
  console.log(`  mononyms             ${tally.mono}`);
  console.log(`  direct name items    ${direct}`);
  console.log(`  no consistent split  ${tally["no-split"]}`);
  console.log(`  ambiguous split      ${tally.ambiguous}`);
  console.log(`  malformed            ${tally.malformed}`);

  const pairs = [...counts.entries()]
    .map(([key, count]) => {
      const [kanji, kana] = key.split("\t");
      return { kanji, kana, count };
    })
    .sort((a, b) => a.kanji.localeCompare(b.kanji) || a.kana.localeCompare(b.kana));
  const spellings = new Set(pairs.map((pair) => pair.kanji));
  console.log(`\nPairs out: ${pairs.length} over ${spellings.size} spellings`);

  let ambiguousSpellings = 0;
  let covered = 0;
  let decisive = 0;
  for (const readings of readingsOf.values()) {
    if (readings.size < 2) continue;
    ambiguousSpellings++;
  }
  for (const [kanji, readings] of readingsOf) {
    if (readings.size < 2) continue;
    const ranked = [...readings]
      .map((kana) => counts.get(`${kanji}\t${kana}`) ?? 0)
      .sort((a, b) => b - a);
    if (ranked[0] === 0) continue;
    covered++;
    if (ranked[0] > ranked[1]) decisive++;
  }
  console.log(
    `Ambiguous spellings ${ambiguousSpellings}, counted ${covered} ` +
      `(${pct(covered, ambiguousSpellings)}), one reading ahead in ${decisive} (${pct(decisive, covered)})`,
  );

  console.log("\nProbes:");
  for (const probe of ["杏子", "京子", "洋子", "一郎", "高遠", "五十嵐", "後味"]) {
    const ranked = [...(readingsOf.get(probe) ?? [])]
      .map((kana) => [kana, counts.get(`${probe}\t${kana}`) ?? 0] as const)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    console.log(
      `  ${probe}: ${ranked.map(([kana, count]) => `${kana}=${count}`).join(" ") || "(no counts)"}`,
    );
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const header = [
    `# Derived by scripts/build-name-frequency.ts on ${new Date().toISOString().slice(0, 10)}.`,
    "# How often a spelling is read this way when it names a person, counted over",
    "# Wikidata and validated against JMnedict. Undercounts, not probabilities:",
    "# comparable only between readings of the SAME spelling, and a reading with",
    "# no row here has no evidence, not evidence against.",
    "# Sources: P31 wd:Q5 + P1814, P31/P279* wd:Q95074 + P1814, P735, P734.",
    "# kanji\tkana\tcount",
  ].join("\n");
  writeFileSync(
    OUT,
    `${header}\n${pairs.map((p) => `${p.kanji}\t${p.kana}\t${p.count}`).join("\n")}\n`,
  );
  console.log(`\nWritten: ${OUT}`);
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${((100 * part) / whole).toFixed(1)}%`;

if (require.main === module) {
  main().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}
