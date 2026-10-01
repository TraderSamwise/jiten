/**
 * Why is this span highlighted in the reader?
 *
 * Two modes.
 *
 *   yarn why:highlight --list <export.jiten> <surface> [...]
 *     For one surface as it appears on the page, report every bookmarked
 *     entry that could have produced it, with the deinflection path.
 *
 *   yarn why:highlight --list <export.jiten> --text <page.txt> [--json out]
 *     For a whole page, paint it the way the device does and report every
 *     painted span with its provenance, plus how much of the page is covered.
 *     `--diff <earlier.json>` compares against a saved run.
 *
 * The matcher is the shipping one (`explainBookmarkedWordSurfacesInHtml`) and
 * so is the painter (`packages/reader-webview/src/bookmarks.ts`, run under
 * jsdom). Nothing here reimplements either, because an instrument that drifts
 * from the code it measures is worse than no instrument.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { JSDOM } from "jsdom";
import { resolve } from "path";

import {
  type BookmarkSurfaceProvenance,
  explainBookmarkedWordSurfacesInHtml,
} from "../packages/japanese-reader/src/bookmarks";
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

function openDict(): Database.Database {
  if (!existsSync(DICT)) {
    console.error(`Missing ${DICT}. Run yarn build:db.`);
    process.exit(2);
  }
  return new Database(DICT, { readonly: true });
}

function loadBookmarks(listPath: string): { name: string; ids: Set<number> } {
  const exported = JSON.parse(readFileSync(listPath, "utf-8")) as {
    list?: { name?: string };
    entries: { entryId: number | string }[];
  };
  const ids = new Set<number>();
  for (const entry of exported.entries) {
    const id = Number(entry.entryId);
    if (Number.isFinite(id)) ids.add(id);
  }
  return { name: exported.list?.name ?? listPath, ids };
}

function asReaderDb(db: Database.Database) {
  return {
    async getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...(params ?? [])) as T[];
    },
    async getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
      return (db.prepare(sql).get(...(params ?? [])) as T) ?? null;
    },
  };
}

function describeEntry(db: Database.Database, entryId: number): string {
  const row = db
    .prepare(
      `SELECT (SELECT group_concat(text,'/') FROM kanji WHERE entry_id=?) k,
              (SELECT group_concat(text,'/') FROM kana  WHERE entry_id=?) r,
              (SELECT group_concat(part_of_speech,'|') FROM senses WHERE entry_id=?) p`,
    )
    .get(entryId, entryId, entryId) as { k: string | null; r: string | null; p: string | null };
  return `${row.k ?? "(kana only)"} [${row.r}] ${readTags(row.p)}`;
}

function explainOne(db: Database.Database, bookmarked: Set<number>, surface: string) {
  const lookup = db.prepare(`
    SELECT e.id, e.common,
           (SELECT group_concat(text, '/') FROM kanji WHERE entry_id = e.id) AS kanji,
           (SELECT group_concat(text, '/') FROM kana  WHERE entry_id = e.id) AS kana,
           (SELECT group_concat(glosses, '; ') FROM senses WHERE entry_id = e.id) AS gloss,
           (SELECT group_concat(part_of_speech, '/') FROM senses WHERE entry_id = e.id) AS pos
      FROM entries e
     WHERE e.id IN (SELECT entry_id FROM kanji WHERE text = ?)
        OR e.id IN (SELECT entry_id FROM kana  WHERE text = ?)`);

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

interface PaintedSpan {
  start: number;
  text: string;
}

interface PageReport {
  text: string;
  spans: PaintedSpan[];
  boxes: PaintedSpan[];
  japaneseChars: number;
  coveredChars: number;
}

function isJapanese(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff)
  );
}

/**
 * Paint with the device's own painter. It needs a DOM, so the webview module
 * is imported only after jsdom has installed the globals it reads at load.
 */
async function paintPage(html: string, surfaces: string[]): Promise<PageReport> {
  const dom = new JSDOM(`<body><div id="page">${html}</div></body>`);
  const globals = globalThis as Record<string, unknown>;
  globals.window = dom.window;
  globals.document = dom.window.document;
  // Node 24 defines navigator as a getter-only global, so it has to be redefined.
  Object.defineProperty(globals, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  globals.Node = dom.window.Node;
  globals.NodeFilter = dom.window.NodeFilter;
  globals.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);

  const { state } = await import("../packages/reader-webview/src/state");
  const { resetBookmarkHighlightState, setBookmarkHighlights } =
    await import("../packages/reader-webview/src/bookmarks");

  const page = dom.window.document.getElementById("page")!;
  state.pageEl = page as unknown as HTMLElement;
  state.contentEl = page as unknown as HTMLElement;
  resetBookmarkHighlightState();
  setBookmarkHighlights({ version: "instrument", surfaces });

  const walker = dom.window.document.createTreeWalker(page, dom.window.NodeFilter.SHOW_TEXT);
  let text = "";
  const spans: PaintedSpan[] = [];
  const boxes: PaintedSpan[] = [];
  let box: PaintedSpan | null = null;

  const ancestor = (node: Node, test: (el: Element) => boolean): Element | null => {
    let parent: Node | null = node.parentNode;
    while (parent) {
      if (parent.nodeType === 1 && test(parent as Element)) return parent as Element;
      parent = parent.parentNode;
    }
    return null;
  };

  let lastSpanElement: Element | null = null;
  let lastBlock: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (ancestor(node, (el) => el.tagName === "RT")) continue;
    const chunk = node.textContent ?? "";
    if (chunk.length === 0) continue;

    // Two paragraphs have no text node between them, so without this a span
    // ending one line would fuse with one starting the next.
    const block = ancestor(node, (el) => el.tagName === "P");
    if (block !== lastBlock && box) {
      boxes.push(box);
      box = null;
      lastSpanElement = null;
    }
    lastBlock = block;

    const span = ancestor(node, (el) => el.classList.contains("bookmarked-word"));
    if (span) {
      if (span !== lastSpanElement) spans.push({ start: text.length, text: chunk });
      else spans[spans.length - 1].text += chunk;
      lastSpanElement = span;
      if (box) box.text += chunk;
      else box = { start: text.length, text: chunk };
    } else {
      if (box) {
        boxes.push(box);
        box = null;
      }
      lastSpanElement = null;
    }
    text += chunk;
  }
  if (box) boxes.push(box);

  const japaneseChars = [...text].filter(isJapanese).length;
  const coveredChars = boxes.reduce((sum, b) => sum + [...b.text].filter(isJapanese).length, 0);
  return { text, spans, boxes, japaneseChars, coveredChars };
}

function readPageText(path: string): string {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => `<p>${line}</p>`)
    .join("");
}

async function reportPage(
  db: Database.Database,
  bookmarked: Set<number>,
  textPath: string,
): Promise<void> {
  const html = readPageText(textPath);
  const provenance = await explainBookmarkedWordSurfacesInHtml(asReaderDb(db), html, {
    version: "instrument",
    hasEntryId: (entryId: number) => bookmarked.has(entryId),
  });
  const report = await paintPage(html, [...provenance.keys()]);

  const describeProvenance = (entries: BookmarkSurfaceProvenance[] | undefined): string[] =>
    (entries ?? []).map(
      (entry) =>
        `      ${entry.entryId} ${describeEntry(db, entry.entryId)} <- "${entry.word}" ` +
        `${entry.reasons.length ? entry.reasons.join(" < ") : "as written"} (${entry.via})`,
    );

  console.log(`${report.spans.length} painted spans, ${report.boxes.length} visible boxes\n`);
  for (const box of report.boxes) {
    const parts = report.spans.filter(
      (span) => span.start >= box.start && span.start < box.start + box.text.length,
    );
    const merged = parts.length > 1 ? `  [${parts.length} spans merged into one box]` : "";
    console.log(`  @${box.start} ${box.text}${merged}`);
    for (const part of parts) {
      if (parts.length > 1) console.log(`    ${part.text}`);
      for (const line of describeProvenance(provenance.get(part.text))) console.log(line);
    }
  }

  const percent = report.japaneseChars
    ? ((report.coveredChars / report.japaneseChars) * 100).toFixed(1)
    : "0.0";
  console.log(
    `\n${provenance.size} distinct surfaces, ${report.spans.length} spans, ` +
      `${report.boxes.length} boxes, ${report.coveredChars}/${report.japaneseChars} ` +
      `Japanese characters covered (${percent}%)`,
  );

  const diffPath = arg("--diff");
  if (diffPath) {
    const before = JSON.parse(readFileSync(diffPath, "utf-8")) as {
      boxes: PaintedSpan[];
      coveredChars: number;
    };
    const key = (span: PaintedSpan) => `${span.start}:${span.text}`;
    const beforeKeys = new Set(before.boxes.map(key));
    const afterKeys = new Set(report.boxes.map(key));
    console.log(`\nagainst ${diffPath}:`);
    for (const box of before.boxes) if (!afterKeys.has(key(box))) console.log(`  - ${box.text}`);
    for (const box of report.boxes) if (!beforeKeys.has(key(box))) console.log(`  + ${box.text}`);
    console.log(`  coverage ${before.coveredChars} -> ${report.coveredChars} characters`);
  }
  const jsonPath = arg("--json");
  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          spans: report.spans,
          boxes: report.boxes,
          coveredChars: report.coveredChars,
          japaneseChars: report.japaneseChars,
          surfaces: [...provenance.keys()].sort(),
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${jsonPath}`);
  }
}

async function main() {
  const listPath = arg("--list");
  if (!listPath || !existsSync(listPath)) {
    console.error("Usage: yarn why:highlight --list <export.jiten> [--text <page.txt>] [surface…]");
    process.exit(2);
  }

  const db = openDict();
  const { name, ids } = loadBookmarks(listPath);
  console.log(`${name}: ${ids.size} bookmarked entries\n`);

  const textPath = arg("--text");
  if (textPath) {
    if (!existsSync(textPath)) {
      console.error(`Missing ${textPath}.`);
      process.exit(2);
    }
    await reportPage(db, ids, textPath);
    return;
  }

  const flagValues = new Set(["--list", "--text", "--json", "--diff"].map(arg));
  const surfaces = process.argv
    .slice(2)
    .filter((value) => !value.startsWith("--") && !flagValues.has(value));
  for (const surface of surfaces) explainOne(db, ids, surface);
}

void main();
