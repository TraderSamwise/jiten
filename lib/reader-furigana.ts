import type * as SQLite from "expo-sqlite";
import { getKanjiLiteralsByJlptAsync } from "@/db/kanji-search";
import { deinflect } from "./deinflect";
import type { FuriganaLevel } from "@/stores/settings";

// ─── Build kanji set from enabled levels ───

const LEVEL_MAP: Record<string, number | null> = {
  n5: 5,
  n4: 4,
  n3: 3,
  n2: 2,
  n1: 1,
  nonJouyou: null,
};

export interface FuriganaKanjiSet {
  all: boolean;
  chars: Set<string>;
}

export async function buildFuriganaKanjiSet(
  dictDb: SQLite.SQLiteDatabase,
  levels: Record<FuriganaLevel, boolean>,
): Promise<FuriganaKanjiSet> {
  if (levels.all) return { all: true, chars: new Set() };

  const chars = new Set<string>();
  const queries: Promise<string[]>[] = [];
  for (const [key, dbLevel] of Object.entries(LEVEL_MAP)) {
    if (levels[key as FuriganaLevel]) {
      queries.push(getKanjiLiteralsByJlptAsync(dictDb, dbLevel));
    }
  }
  const results = await Promise.all(queries);
  for (const literals of results) {
    for (const lit of literals) chars.add(lit);
  }
  return { all: false, chars };
}

/** Serialize a FuriganaKanjiSet for sending to the WebView. */
export function serializeKanjiSet(set: FuriganaKanjiSet): string {
  if (set.all) return "all";
  if (set.chars.size === 0) return "";
  return [...set.chars].join("");
}

// ─── Character classification (RN-side, mirrors lib/reader/src/japanese.ts) ───

function isKanji(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

// ─── Okurigana stripping ───

function isKana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

function stripOkurigana(
  kanjiForm: string,
  kanaForm: string,
): { kanjiPart: string; reading: string; kanjiPartLen: number } {
  const kanjiChars = [...kanjiForm];
  const kanaChars = [...kanaForm];

  let okuCount = 0;
  while (
    okuCount < kanjiChars.length &&
    okuCount < kanaChars.length &&
    kanjiChars[kanjiChars.length - 1 - okuCount] === kanaChars[kanaChars.length - 1 - okuCount] &&
    isKana(kanjiChars[kanjiChars.length - 1 - okuCount])
  ) {
    okuCount++;
  }

  const kanjiPart = kanjiChars.slice(0, kanjiChars.length - okuCount).join("");
  const reading = kanaChars.slice(0, kanaChars.length - okuCount).join("");

  return { kanjiPart, reading, kanjiPartLen: kanjiChars.length - okuCount };
}

// ─── Batch dictionary lookup ───

const BATCH_SIZE = 500;

interface DictMatch {
  kanjiForm: string;
  kanaForm: string;
  common: boolean;
}

async function batchLookup(
  dictDb: SQLite.SQLiteDatabase,
  searchWords: string[],
): Promise<Map<string, DictMatch>> {
  if (searchWords.length === 0) return new Map();

  // Phase A: Find which search words exist in the kanji table
  const wordToEntryIds = new Map<string, number[]>();

  for (let i = 0; i < searchWords.length; i += BATCH_SIZE) {
    const batch = searchWords.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const rows = await dictDb.getAllAsync<{ text: string; entry_id: number }>(
      `SELECT text, entry_id FROM kanji WHERE text IN (${ph})`,
      batch,
    );
    for (const r of rows) {
      if (!wordToEntryIds.has(r.text)) wordToEntryIds.set(r.text, []);
      wordToEntryIds.get(r.text)!.push(r.entry_id);
    }
  }

  const allIds = new Set<number>();
  for (const ids of wordToEntryIds.values()) {
    for (const id of ids) allIds.add(id);
  }
  if (allIds.size === 0) return new Map();

  const idList = [...allIds];

  // Phase B: Batch fetch forms + common flag
  const entryKanji = new Map<number, string[]>();
  const entryKana = new Map<number, string>();
  const entryCommon = new Map<number, boolean>();

  for (let i = 0; i < idList.length; i += BATCH_SIZE) {
    const batch = idList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");

    const [kanjiRows, kanaRows, entryRows] = await Promise.all([
      dictDb.getAllAsync<{ entry_id: number; text: string }>(
        `SELECT entry_id, text FROM kanji WHERE entry_id IN (${ph}) ORDER BY rowid`,
        batch,
      ),
      dictDb.getAllAsync<{ entry_id: number; text: string }>(
        `SELECT entry_id, text FROM kana WHERE entry_id IN (${ph}) ORDER BY rowid`,
        batch,
      ),
      dictDb.getAllAsync<{ id: number; common: number }>(
        `SELECT id, common FROM entries WHERE id IN (${ph})`,
        batch,
      ),
    ]);

    for (const r of entryRows) entryCommon.set(r.id, !!r.common);
    for (const r of kanjiRows) {
      if (!entryKanji.has(r.entry_id)) entryKanji.set(r.entry_id, []);
      entryKanji.get(r.entry_id)!.push(r.text);
    }
    for (const r of kanaRows) {
      if (!entryKana.has(r.entry_id)) entryKana.set(r.entry_id, r.text);
    }
  }

  // Phase C: For each search word, pick best entry
  const result = new Map<string, DictMatch>();

  for (const [word, ids] of wordToEntryIds) {
    let bestMatch: DictMatch | null = null;
    let bestCommon = false;

    for (const id of ids) {
      const kana = entryKana.get(id);
      if (!kana) continue;
      const common = entryCommon.get(id) ?? false;
      const kanjiTexts = entryKanji.get(id) ?? [];
      const kanjiForm = kanjiTexts.find((k) => k === word) || kanjiTexts[0] || word;

      if (!bestMatch || (common && !bestCommon)) {
        bestMatch = { kanjiForm, kanaForm: kana, common };
        bestCommon = common;
      }
      if (bestCommon) break;
    }

    if (bestMatch) result.set(word, bestMatch);
  }

  return result;
}

// ─── Public API ───

/**
 * Resolve a batch of surface substrings to furigana readings.
 * Called by the RN query handler when the WebView requests lookups.
 */
export async function resolveFuriganaBatch(
  surfaces: string[],
  dictDb: SQLite.SQLiteDatabase,
): Promise<Record<string, { kanjiPart: string; reading: string; kanjiPartLen: number }>> {
  // Deinflect all surfaces, collect unique search words
  const surfaceToDeinflected = new Map<string, string[]>();
  const allSearchWords = new Set<string>();

  for (const surface of surfaces) {
    const candidates = deinflect(surface);
    const words = candidates.map((c) => c.word);
    surfaceToDeinflected.set(surface, words);
    for (const w of words) allSearchWords.add(w);
  }

  // Batch lookup
  const lookupMap = await batchLookup(dictDb, [...allSearchWords]);

  // Resolve each surface
  const result: Record<string, { kanjiPart: string; reading: string; kanjiPartLen: number }> = {};

  for (const surface of surfaces) {
    const deinflected = surfaceToDeinflected.get(surface)!;
    for (const word of deinflected) {
      const match = lookupMap.get(word);
      if (match && match.kanaForm) {
        const { kanjiPart, reading, kanjiPartLen } = stripOkurigana(
          match.kanjiForm,
          match.kanaForm,
        );
        if (reading) {
          result[surface] = { kanjiPart, reading, kanjiPartLen };
          break;
        }
      }
    }
  }

  return result;
}

// ─── HTML string furigana injection (RN-side) ───

/**
 * Test if a kanji character should get furigana, given the kanji set.
 */
function kanjiMatches(ch: string, kanjiSet: FuriganaKanjiSet): boolean {
  if (!isKanji(ch)) return false;
  if (kanjiSet.all) return true;
  return kanjiSet.chars.has(ch);
}

/**
 * Extract unique kanji substrings from HTML text content for batch lookup.
 * Scans visible text (skips tags and <rt> content), finds all substrings
 * starting with a matching kanji (up to length 10), and returns unique surfaces.
 */
export function extractSurfacesFromHtml(html: string, kanjiSet: FuriganaKanjiSet): string[] {
  const visibleText = extractVisibleText(html);
  const chars = [...visibleText];
  const seen = new Set<string>();
  const surfaces: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (!kanjiMatches(chars[i], kanjiSet)) continue;
    const maxLen = Math.min(chars.length - i, 10);
    for (let len = maxLen; len >= 1; len--) {
      const surface = chars.slice(i, i + len).join("");
      if (seen.has(surface)) continue;
      seen.add(surface);
      surfaces.push(surface);
    }
  }

  return surfaces;
}

/**
 * Extract visible text from HTML, skipping tags and <rt> content.
 */
function extractVisibleText(html: string): string {
  let result = "";
  let inTag = false;
  let rtDepth = 0;
  let i = 0;

  while (i < html.length) {
    const ch = html[i];

    if (ch === "<") {
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        rtDepth++;
        const close = html.indexOf(">", i);
        i = close >= 0 ? close + 1 : i + 1;
        continue;
      }
      if (html.startsWith("</rt>", i)) {
        rtDepth = Math.max(0, rtDepth - 1);
        i += 5;
        continue;
      }
      inTag = true;
      i++;
      continue;
    }

    if (ch === ">") {
      inTag = false;
      i++;
      continue;
    }

    if (!inTag && rtDepth === 0) {
      if (ch === "&") {
        const semi = html.indexOf(";", i);
        if (semi >= 0 && semi - i <= 8) {
          result += html.slice(i, semi + 1);
          i = semi + 1;
          continue;
        }
      }
      result += ch;
    }

    i++;
  }

  return result;
}

export interface FuriganaEntry {
  kanjiPart: string;
  reading: string;
  kanjiPartLen: number;
}

/**
 * Apply furigana map to an HTML string.
 *
 * Wraps matched kanji substrings in <ruby>base<rt>reading</rt></ruby>.
 * HTML-aware: skips content inside tags, <ruby>, and <rt> elements.
 * Uses longest-first matching (same logic as the WebView processTextNode).
 *
 * Single-pass state machine:
 * 1. Track state: inTag, rubyDepth, rtDepth
 * 2. In text content: try longest-first kanji match against map
 * 3. Match -> emit ruby element + trailing okurigana
 * 4. No match -> emit character as-is
 * 5. Inside tags/ruby/rt -> emit as-is
 */
export function applyFuriganaToHtml(
  html: string,
  furiganaMap: Map<string, FuriganaEntry>,
  kanjiSet: FuriganaKanjiSet,
): string {
  if (furiganaMap.size === 0) return html;

  // Pre-sort map keys by length descending for longest-first matching
  const sortedSurfaces = [...furiganaMap.keys()].sort((a, b) => [...b].length - [...a].length);

  let out = "";
  let i = 0;
  let rubyDepth = 0;
  let rtDepth = 0;

  while (i < html.length) {
    const ch = html[i];

    // ── Tag detection ──
    if (ch === "<") {
      if (html.startsWith("<ruby", i)) {
        const close = html.indexOf(">", i);
        if (close >= 0) {
          out += html.slice(i, close + 1);
          i = close + 1;
          rubyDepth++;
          continue;
        }
      }
      if (html.startsWith("</ruby>", i)) {
        out += "</ruby>";
        i += 7;
        rubyDepth = Math.max(0, rubyDepth - 1);
        continue;
      }
      if (html.startsWith("<rt>", i) || html.startsWith("<rt ", i)) {
        const close = html.indexOf(">", i);
        if (close >= 0) {
          out += html.slice(i, close + 1);
          i = close + 1;
          rtDepth++;
          continue;
        }
      }
      if (html.startsWith("</rt>", i)) {
        out += "</rt>";
        i += 5;
        rtDepth = Math.max(0, rtDepth - 1);
        continue;
      }

      // Generic tag: copy everything up to and including >
      const close = html.indexOf(">", i);
      if (close >= 0) {
        out += html.slice(i, close + 1);
        i = close + 1;
      } else {
        out += ch;
        i++;
      }
      continue;
    }

    // ── Inside <rt> or source <ruby> — pass through ──
    if (rtDepth > 0 || rubyDepth > 0) {
      out += ch;
      i++;
      continue;
    }

    // ── Text content — try kanji matching ──

    // HTML entity — emit as-is
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        out += html.slice(i, semi + 1);
        i = semi + 1;
        continue;
      }
    }

    // Try longest-first match if this char is a matching kanji
    if (kanjiMatches(ch, kanjiSet)) {
      let matched = false;
      const remaining = getVisibleCharsFrom(html, i);

      for (const surface of sortedSurfaces) {
        const surfaceChars = [...surface];
        if (surfaceChars.length > remaining.length) continue;

        let isMatch = true;
        for (let s = 0; s < surfaceChars.length; s++) {
          if (remaining[s] !== surfaceChars[s]) {
            isMatch = false;
            break;
          }
        }

        if (!isMatch) continue;

        const entry = furiganaMap.get(surface)!;

        out += `<ruby>${entry.kanjiPart}<rt>${entry.reading}</rt></ruby>`;

        // Emit trailing okurigana (chars after kanjiPart within the matched surface)
        const kanjiPartChars = [...entry.kanjiPart];
        if (surfaceChars.length > kanjiPartChars.length) {
          const trailing = surfaceChars.slice(kanjiPartChars.length).join("");
          out += trailing;
        }

        // Advance past the matched characters in the raw HTML
        i = advanceHtmlPastChars(html, i, surfaceChars.length);
        matched = true;
        break;
      }

      if (!matched) {
        out += ch;
        i++;
      }
      continue;
    }

    // Default: emit character as-is
    out += ch;
    i++;
  }

  return out;
}

/**
 * Get an array of visible characters starting from position `start` in the HTML.
 * Skips tags and returns up to 10 chars (max surface length).
 */
function getVisibleCharsFrom(html: string, start: number): string[] {
  const chars: string[] = [];
  let i = start;
  while (i < html.length && chars.length < 10) {
    const ch = html[i];
    if (ch === "<") {
      // Stop at closing block tags (</p>, </div>) to avoid crossing paragraph boundaries
      if (html.startsWith("</p>", i) || html.startsWith("</div>", i)) break;
      const close = html.indexOf(">", i);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        chars.push(html.slice(i, semi + 1));
        i = semi + 1;
        continue;
      }
    }
    chars.push(ch);
    i++;
  }
  return chars;
}

/**
 * Advance position in HTML past `count` visible characters,
 * skipping over any tags encountered along the way.
 */
function advanceHtmlPastChars(html: string, start: number, count: number): number {
  let i = start;
  let consumed = 0;
  while (i < html.length && consumed < count) {
    const ch = html[i];
    if (ch === "<") {
      // Stop at closing block tags to avoid crossing paragraph boundaries
      if (html.startsWith("</p>", i) || html.startsWith("</div>", i)) break;
      const close = html.indexOf(">", i);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi >= 0 && semi - i <= 8) {
        consumed++;
        i = semi + 1;
        continue;
      }
    }
    consumed++;
    i++;
  }
  return i;
}

/**
 * No-op: ruby spacers are no longer needed since alignment is done via scrollLeft.
 */
export function injectRubySpacers(html: string): string {
  return html;
}
