/**
 * Measures the set-phrase matcher over real text at the slice sizes the reader
 * actually renders.
 *
 *   yarn tsx scripts/expression-coverage.ts [--slice 600] [--limit 40000]
 *
 * `renderSliceHtml` builds one slice of `charsPerPage * 3` at a time, which is
 * ~600 characters on a phone and ~1800 on a tablet, so those are the sizes worth
 * timing. Accuracy is reported as the split between phrases written exactly as
 * the dictionary spells them and phrases only reachable by relaxing a particle
 * or an inflection — the second number is what this whole thing buys.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import {
  buildExpressionIndex,
  findExpressions,
  type ExpressionIndex,
} from "../packages/japanese-reader/src/expressions";
import type { ReaderSqlDb } from "../packages/japanese-reader/src/backend";

const ROOT = resolve(__dirname, "..");
const DICT = resolve(ROOT, "assets/dictionary.db");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function openDb(path: string): { raw: Database.Database; db: ReaderSqlDb } {
  const raw = new Database(path, { readonly: true });
  return {
    raw,
    db: {
      getAllAsync: async <T>(sql: string, params?: unknown[]) =>
        (params ? raw.prepare(sql).all(...(params as never[])) : raw.prepare(sql).all()) as T[],
      getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
        ((params ? raw.prepare(sql).get(...(params as never[])) : raw.prepare(sql).get()) as T) ??
        null,
    },
  };
}

/** Aozora ruby and editor marks are not part of the prose. */
function stripAozora(text: string): string {
  return text
    .replace(/［＃[^］]*］/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/[｜|]/g, "")
    .replace(/※/g, "");
}

function loadSources(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];

  const bocchan = resolve(ROOT, "test/corpus/bocchan.txt");
  if (existsSync(bocchan)) {
    out.push({ name: "坊っちゃん (Soseki, 1906)", text: readFileSync(bocchan, "utf8") });
  }

  const starter = resolve(ROOT, "lib/starter-book-content.ts");
  if (existsSync(starter)) {
    const src = readFileSync(starter, "utf8");
    const body = src.slice(src.indexOf("`") + 1, src.lastIndexOf("`"));
    out.push({ name: "夢十夜 (Soseki, 1908)", text: stripAozora(body) });
  }

  return out;
}

async function main() {
  if (!existsSync(DICT)) {
    console.error(`missing ${DICT}\nRun the app once to download the databases, or yarn build:db.`);
    process.exit(2);
  }

  const sliceSize = Number(arg("--slice") ?? 600);
  const limit = Number(arg("--limit") ?? 40000);

  const { raw, db } = openDb(DICT);
  const buildStart = performance.now();
  const index: ExpressionIndex = await buildExpressionIndex(db);
  const buildMs = performance.now() - buildStart;

  console.log(`index          ${index.size} expressions, ${index.byAnchor.size} anchors`);
  const buckets = [...index.byAnchor.values()].map((b) => b.length).sort((a, b) => b - a);
  console.log(`bucket sizes   max ${buckets[0]}, median ${buckets[buckets.length >> 1]}`);
  console.log(`build          ${buildMs.toFixed(0)} ms (once per session)`);
  console.log(`slice          ${sliceSize} chars\n`);

  for (const source of loadSources()) {
    const chars = [...source.text].slice(0, limit);
    const slices: string[] = [];
    for (let i = 0; i < chars.length; i += sliceSize) {
      slices.push(chars.slice(i, i + sliceSize).join(""));
    }

    // Warm the deinflector and any lazy paths before timing.
    findExpressions(slices[0] ?? "", index);

    const times: number[] = [];
    let exact = 0;
    let relaxed = 0;
    const distinct = new Map<string, number>();

    for (const slice of slices) {
      const t0 = performance.now();
      const matches = findExpressions(slice, index);
      times.push(performance.now() - t0);
      for (const match of matches) {
        if (match.surface === match.form) exact++;
        else {
          relaxed++;
          const key = `${match.form}  ~  ${match.surface}`;
          distinct.set(key, (distinct.get(key) ?? 0) + 1);
        }
      }
    }

    times.sort((a, b) => a - b);
    const total = exact + relaxed;
    const p50 = times[times.length >> 1];
    const p95 = times[Math.floor(times.length * 0.95)];
    const worst = times[times.length - 1];

    console.log(`${source.name}`);
    console.log(`  ${chars.length} chars in ${slices.length} slices`);
    console.log(
      `  per slice   p50 ${p50.toFixed(2)} ms   p95 ${p95.toFixed(2)} ms   max ${worst.toFixed(2)} ms`,
    );
    console.log(
      `  matches     ${total} total, ${(total / slices.length).toFixed(1)} per slice ` +
        `(${exact} exact, ${relaxed} relaxed)`,
    );
    console.log(`  relaxed share ${total ? Math.round((relaxed / total) * 100) : 0}%`);
    const top = [...distinct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const [key, n] of top) console.log(`      ${n}x  ${key}`);
    console.log();
  }

  raw.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
