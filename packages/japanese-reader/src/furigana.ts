import { toHiragana } from "wanakana";
import {
  AUTO_NAME_ONLY_CONFIDENCE,
  computeAutoNameConfidence,
  type AutoNameNameCandidate,
  type AutoNameWordCandidate,
} from "./auto-name";
import { deinflect } from "./deinflect";
import { getKanjiBatchAsync, getKanjiLiteralsByJlptAsync } from "./furigana-db";
import type { ReaderSqlDb } from "./backend";
import {
  classifyReaderReadingPattern,
  type ReaderReadingPattern,
} from "@jiten/japanese-reader-core";
import {
  defaultReaderFuriganaSettings,
  type FuriganaEntry,
  type FuriganaKanjiSet,
  type FuriganaMatchLevel,
  type ReaderFuriganaRule,
  type ReaderFuriganaSettings,
} from "./furigana-types";

export type {
  FuriganaEntry,
  FuriganaKanjiSet,
  FuriganaMatchLevel,
  ReaderFuriganaRule,
  ReaderFuriganaSettings,
} from "./furigana-types";
export {
  defaultFuriganaMatchLevels,
  defaultReaderFuriganaRuleLevels,
  defaultReaderFuriganaSettings,
} from "./furigana-types";

const LEVEL_MAP: Record<FuriganaMatchLevel, number | null> = {
  n5: 5,
  n4: 4,
  n3: 3,
  n2: 2,
  n1: 1,
  nonJouyou: null,
};

export async function buildFuriganaKanjiSet(
  dictDb: ReaderSqlDb,
  levels: Record<FuriganaMatchLevel, boolean>,
): Promise<FuriganaKanjiSet> {
  const chars = new Set<string>();
  const queries: Promise<string[]>[] = [];
  for (const [key, dbLevel] of Object.entries(LEVEL_MAP)) {
    if (levels[key as FuriganaMatchLevel]) {
      queries.push(getKanjiLiteralsByJlptAsync(dictDb, dbLevel));
    }
  }
  const results = await Promise.all(queries);
  for (const literals of results) {
    for (const lit of literals) {
      if (isKanji(lit)) chars.add(lit);
    }
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

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x0030 && code <= 0x0039) || (code >= 0xff10 && code <= 0xff19);
}

const DIGIT_TO_KANJI: Record<string, string> = {
  "0": "〇",
  "\uff10": "〇",
  "1": "一",
  "\uff11": "一",
  "2": "二",
  "\uff12": "二",
  "3": "三",
  "\uff13": "三",
  "4": "四",
  "\uff14": "四",
  "5": "五",
  "\uff15": "五",
  "6": "六",
  "\uff16": "六",
  "7": "七",
  "\uff17": "七",
  "8": "八",
  "\uff18": "八",
  "9": "九",
  "\uff19": "九",
};

function normalizeDigitsToKanji(s: string): string {
  return s.replace(/[0-9\uff10-\uff19]/g, (ch) => DIGIT_TO_KANJI[ch] ?? ch);
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
let hasJlptCol: boolean | null = null;
type KanjiInfo = Awaited<ReturnType<typeof getKanjiBatchAsync>>[number];
const kanjiInfoCache = new Map<string, KanjiInfo>();

interface DictMatch {
  kanjiForm: string;
  kanaForm: string;
  common: boolean;
  jlptLevel: number | null;
  irregularReading: boolean;
}

interface CounterMatch {
  kanjiForm: string;
  kanaForm: string;
}

interface NameMatch {
  kanjiForm: string;
  kanaForm: string;
  nameType: string | null;
  translation: string | null;
}

export interface ResolveFuriganaBatchOptions {
  includeNames?: boolean;
  includeCounters?: boolean;
}

async function batchLookupCounters(
  extDb: ReaderSqlDb | null | undefined,
  surfaces: string[],
): Promise<Map<string, CounterMatch>> {
  const result = new Map<string, CounterMatch>();
  if (!extDb || surfaces.length === 0) return result;

  const normalizedToSurface = new Map<string, string>();
  const combinedForms = new Set<string>();
  for (const surface of surfaces) {
    combinedForms.add(surface);
    normalizedToSurface.set(surface, surface);
    const normalized = normalizeDigitsToKanji(surface);
    if (normalized !== surface) {
      combinedForms.add(normalized);
      normalizedToSurface.set(normalized, surface);
    }
  }

  const allForms = [...combinedForms];
  for (let i = 0; i < allForms.length; i += BATCH_SIZE) {
    const batch = allForms.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const rows = await extDb.getAllAsync<{ combined_kanji: string; reading: string }>(
      `SELECT combined_kanji, reading
       FROM counter_readings
       WHERE combined_kanji IN (${ph})`,
      batch,
    );
    for (const row of rows) {
      const surface = normalizedToSurface.get(row.combined_kanji) ?? row.combined_kanji;
      if (!result.has(surface)) {
        result.set(surface, {
          kanjiForm: surface,
          kanaForm: row.reading,
        });
      }
    }
  }

  return result;
}

async function batchLookup(
  dictDb: ReaderSqlDb,
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

  // Phase B: Batch fetch forms + common flag + jlpt_level + tags
  const entryKanji = new Map<number, string[]>();
  const entryKana = new Map<number, string>();
  const entryCommon = new Map<number, boolean>();
  const entryJlpt = new Map<number, number | null>();
  const entryIrregular = new Map<number, boolean>();

  const IRREGULAR_TAGS = new Set(["ateji", "gikun", "iK", "ik"]);

  for (let i = 0; i < idList.length; i += BATCH_SIZE) {
    const batch = idList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");

    // Fetch entries with jlpt_level (fallback for old DBs without the column)
    let entryRowsPromise: Promise<{ id: number; common: number; jlpt_level: number | null }[]>;
    if (hasJlptCol !== false) {
      entryRowsPromise = dictDb
        .getAllAsync<{ id: number; common: number; jlpt_level: number | null }>(
          `SELECT id, common, jlpt_level FROM entries WHERE id IN (${ph})`,
          batch,
        )
        .then((rows) => {
          hasJlptCol = true;
          return rows;
        })
        .catch((e) => {
          if (hasJlptCol === null && String(e).includes("jlpt_level")) {
            hasJlptCol = false;
            return dictDb
              .getAllAsync<{
                id: number;
                common: number;
              }>(`SELECT id, common FROM entries WHERE id IN (${ph})`, batch)
              .then((rows) => rows.map((r) => ({ ...r, jlpt_level: null as number | null })));
          }
          throw e;
        });
    } else {
      entryRowsPromise = dictDb
        .getAllAsync<{
          id: number;
          common: number;
        }>(`SELECT id, common FROM entries WHERE id IN (${ph})`, batch)
        .then((rows) => rows.map((r) => ({ ...r, jlpt_level: null as number | null })));
    }

    const [kanjiRows, kanaRows, entryRows] = await Promise.all([
      dictDb.getAllAsync<{ entry_id: number; text: string; tags: string | null }>(
        `SELECT entry_id, text, tags FROM kanji WHERE entry_id IN (${ph}) ORDER BY rowid`,
        batch,
      ),
      dictDb.getAllAsync<{ entry_id: number; text: string; tags: string | null }>(
        `SELECT entry_id, text, tags FROM kana WHERE entry_id IN (${ph}) ORDER BY rowid`,
        batch,
      ),
      entryRowsPromise,
    ]);

    for (const r of entryRows) {
      entryCommon.set(r.id, !!r.common);
      entryJlpt.set(r.id, r.jlpt_level);
    }
    for (const r of kanjiRows) {
      if (!entryKanji.has(r.entry_id)) entryKanji.set(r.entry_id, []);
      entryKanji.get(r.entry_id)!.push(r.text);
      // Check for irregular reading tags
      if (r.tags) {
        try {
          const tags: string[] = JSON.parse(r.tags);
          if (tags.some((t) => IRREGULAR_TAGS.has(t))) {
            entryIrregular.set(r.entry_id, true);
          }
        } catch {}
      }
    }
    for (const r of kanaRows) {
      if (!entryKana.has(r.entry_id)) entryKana.set(r.entry_id, r.text);
      // Check for irregular reading tags on kana too
      if (r.tags) {
        try {
          const tags: string[] = JSON.parse(r.tags);
          if (tags.some((t) => IRREGULAR_TAGS.has(t))) {
            entryIrregular.set(r.entry_id, true);
          }
        } catch {}
      }
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
        bestMatch = {
          kanjiForm,
          kanaForm: kana,
          common,
          jlptLevel: entryJlpt.get(id) ?? null,
          irregularReading: entryIrregular.get(id) ?? false,
        };
        bestCommon = common;
      }
      if (bestCommon) break;
    }

    if (bestMatch) result.set(word, bestMatch);
  }

  return result;
}

async function batchLookupNames(
  extDb: ReaderSqlDb | null | undefined,
  surfaces: string[],
): Promise<Map<string, NameMatch[]>> {
  const result = new Map<string, NameMatch[]>();
  if (!extDb || surfaces.length === 0) return result;

  const formsBySurface = new Map<string, Set<string>>();
  const surfacesByForm = new Map<string, Set<string>>();
  const allForms = new Set<string>();
  for (const surface of surfaces) {
    const forms = new Set<string>([surface]);
    const hiragana = toHiragana(surface);
    if (hiragana !== surface) forms.add(hiragana);
    formsBySurface.set(surface, forms);
    for (const form of forms) {
      allForms.add(form);
      if (!surfacesByForm.has(form)) surfacesByForm.set(form, new Set());
      surfacesByForm.get(form)!.add(surface);
    }
  }

  const formList = [...allForms];
  for (let i = 0; i < formList.length; i += BATCH_SIZE) {
    const batch = formList.slice(i, i + BATCH_SIZE);
    const ph = batch.map(() => "?").join(",");
    const rows = await extDb.getAllAsync<{
      kanji: string | null;
      kana: string;
      name_type: string | null;
      translation: string | null;
    }>(
      `SELECT kanji, kana, name_type, translation
       FROM names
       WHERE kanji IN (${ph}) OR kana IN (${ph})`,
      [...batch, ...batch],
    );

    for (const row of rows) {
      const matchedSurfaces = new Set<string>();
      for (const surface of surfacesByForm.get(row.kana) ?? []) matchedSurfaces.add(surface);
      if (row.kanji) {
        for (const surface of surfacesByForm.get(row.kanji) ?? []) matchedSurfaces.add(surface);
      }

      for (const surface of matchedSurfaces) {
        if (!result.has(surface)) result.set(surface, []);
        result.get(surface)!.push({
          kanjiForm: row.kanji ?? surface,
          kanaForm: row.kana,
          nameType: row.name_type,
          translation: row.translation,
        });
      }
    }
  }

  return result;
}

function hasKana(text: string): boolean {
  for (const ch of text) {
    if (isKana(ch)) return true;
  }
  return false;
}

function hasKanjiText(text: string): boolean {
  for (const ch of text) {
    if (isKanji(ch)) return true;
  }
  return false;
}

function firstKanjiIndex(text: string): number {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    if (isKanji(chars[i])) return i;
  }
  return -1;
}

function scoreFuriganaWordMatch(
  surface: string,
  match: DictMatch,
  deinflectedWord: string,
): number {
  let score = [...surface].length * 1000;
  if (match.kanjiForm === surface || match.kanaForm === surface) score += 260;
  if (match.common) score += 120;
  if (deinflectedWord !== surface) score -= 80;
  if (hasKanjiText(surface) && hasKana(surface)) score += 120;
  if (hasKana(surface) && !hasKanjiText(surface)) score += 30;
  return score;
}

function scoreFuriganaNameMatch(surface: string, match: NameMatch): number {
  let score = [...surface].length * 1000;
  if (match.kanjiForm === surface || match.kanaForm === surface) score += 260;
  if (match.translation) score += 25;

  const strongTypes = new Set([
    "surname",
    "given",
    "fem",
    "masc",
    "person",
    "place",
    "station",
    "organization",
    "company",
    "product",
    "work",
  ]);
  const types = (match.nameType ?? "").split(",");
  if (types.some((type) => strongTypes.has(type))) score += 90;
  if (types.length === 1 && types[0] === "unclass") score -= 25;
  if (hasKanjiText(surface) && !hasKana(surface)) score += 80;
  return score;
}

function pickBestNameMatch(surface: string, matches: NameMatch[]): NameMatch | null {
  let best: NameMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const score = scoreFuriganaNameMatch(surface, match);
    if (!best || score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best;
}

function shouldConsiderNameFuriganaSurface(surface: string): boolean {
  return hasKanjiText(surface);
}

function resolveLexicalSuffixJlpt(
  surface: string,
  lookupMap: Map<string, DictMatch>,
): number | null | undefined {
  const tryWords = (candidateSurface: string): number | null | undefined => {
    const candidateWords = deinflect(candidateSurface).map((c) => c.word);
    for (const word of candidateWords) {
      const match = lookupMap.get(word);
      if (match?.jlptLevel != null) return match.jlptLevel;
    }
    return undefined;
  };

  const kanjiStart = firstKanjiIndex(surface);
  if (kanjiStart < 0) return undefined;

  const suffixSurface = [...surface].slice(kanjiStart).join("");
  const directJlpt = tryWords(suffixSurface);
  if (directJlpt != null) return directJlpt;

  const suffixChars = [...suffixSurface];
  let trailingKanaStart = suffixChars.length;
  while (trailingKanaStart > 0 && isKana(suffixChars[trailingKanaStart - 1])) {
    trailingKanaStart--;
  }
  if (trailingKanaStart > 0 && trailingKanaStart < suffixChars.length) {
    const coreChars = suffixChars.slice(0, trailingKanaStart);
    if (coreChars.every((ch) => isKanji(ch) || isDigit(ch))) {
      return tryWords(coreChars.join(""));
    }
  }

  return undefined;
}

// ─── Public API ───

/**
 * Resolve a batch of surface substrings to furigana readings.
 * Called by the RN query handler when the WebView requests lookups.
 */
export async function resolveFuriganaBatch(
  surfaces: string[],
  dictDb: ReaderSqlDb,
  extendedDb?: ReaderSqlDb | null,
  options: ResolveFuriganaBatchOptions = {},
): Promise<Record<string, FuriganaEntry>> {
  const { includeNames = true, includeCounters = true } = options;
  // Deinflect all surfaces, collect unique search words
  const surfaceToDeinflected = new Map<string, string[]>();
  const allSearchWords = new Set<string>();

  for (const surface of surfaces) {
    const candidates = deinflect(surface);
    const words = candidates.map((c) => c.word);
    // Also try digit→kanji normalized forms (e.g. １人 → 一人)
    const normalized = normalizeDigitsToKanji(surface);
    if (normalized !== surface) {
      const normCandidates = deinflect(normalized);
      for (const c of normCandidates) {
        if (!words.includes(c.word)) words.push(c.word);
      }
    }
    surfaceToDeinflected.set(surface, words);
    for (const w of words) allSearchWords.add(w);
  }

  // Batch lookup
  const [lookupMap, counterLookupMap, nameLookupMap] = await Promise.all([
    batchLookup(dictDb, [...allSearchWords]),
    includeCounters ? batchLookupCounters(extendedDb, surfaces) : Promise.resolve(new Map()),
    includeNames
      ? batchLookupNames(extendedDb, surfaces)
      : Promise.resolve(new Map<string, NameMatch[]>()),
  ]);

  // Resolve each surface
  const result: Record<string, FuriganaEntry> = {};
  const resolved = new Map<string, FuriganaEntry>();

  for (const surface of surfaces) {
    const counterMatch = counterLookupMap.get(surface);
    if (counterMatch) {
      const { kanjiPart, reading, kanjiPartLen } = stripOkurigana(
        counterMatch.kanjiForm,
        counterMatch.kanaForm,
      );
      if (reading) {
        resolved.set(surface, {
          kanjiPart,
          reading,
          kanjiPartLen,
          isCounter: true,
          fullKanjiForm: counterMatch.kanjiForm,
          fullKanaForm: counterMatch.kanaForm,
        });
        continue;
      }
    }

    const deinflected = surfaceToDeinflected.get(surface)!;
    let bestWordMatch: {
      match: DictMatch;
      score: number;
      deinflectedWord: string;
    } | null = null;

    for (const word of deinflected) {
      const match = lookupMap.get(word);
      if (!match || !match.kanaForm) continue;
      const score = scoreFuriganaWordMatch(surface, match, word);
      if (!bestWordMatch || score > bestWordMatch.score) {
        bestWordMatch = { match, score, deinflectedWord: word };
      }
    }

    const nameMatches = shouldConsiderNameFuriganaSurface(surface)
      ? (nameLookupMap.get(surface) ?? [])
      : [];
    const bestNameMatch = pickBestNameMatch(surface, nameMatches);
    const bestNameScore = bestNameMatch ? scoreFuriganaNameMatch(surface, bestNameMatch) : null;
    const nameConfidence =
      bestNameMatch && bestWordMatch
        ? computeAutoNameConfidence(
            {
              matchedText: surface,
              exactSurface:
                bestNameMatch.kanjiForm === surface || bestNameMatch.kanaForm === surface,
              candidateCount: nameMatches.length,
              nameType: bestNameMatch.nameType,
              hasTranslation: nameMatches.some((name) => !!name.translation),
            } satisfies AutoNameNameCandidate,
            {
              matchedText: surface,
              exactSurface:
                bestWordMatch.match.kanjiForm === surface ||
                bestWordMatch.match.kanaForm === surface,
              exactCommonWord:
                bestWordMatch.match.common &&
                (bestWordMatch.match.kanjiForm === surface ||
                  bestWordMatch.match.kanaForm === surface),
              commonWord: bestWordMatch.match.common,
              deinflected: bestWordMatch.deinflectedWord !== surface,
            } satisfies AutoNameWordCandidate,
          )
        : null;
    const useName =
      !!bestNameMatch &&
      (!bestWordMatch
        ? true
        : (bestNameScore ?? Number.NEGATIVE_INFINITY) > bestWordMatch.score &&
          (nameConfidence ?? 0) >= AUTO_NAME_ONLY_CONFIDENCE);
    const chosen = useName ? bestNameMatch : bestWordMatch?.match;
    if (!chosen) continue;

    const { kanjiPart, reading, kanjiPartLen } = stripOkurigana(chosen.kanjiForm, chosen.kanaForm);
    if (!reading) continue;

    const entry: FuriganaEntry = {
      kanjiPart,
      reading,
      kanjiPartLen,
      fullKanjiForm: chosen.kanjiForm,
      fullKanaForm: chosen.kanaForm,
    };
    if (useName) {
      entry.isName = true;
    } else if (bestWordMatch) {
      entry.wordJlpt =
        bestWordMatch.match.jlptLevel ?? resolveLexicalSuffixJlpt(surface, lookupMap) ?? undefined;
      if (bestWordMatch.match.irregularReading) entry.irregularReading = true;
    }
    resolved.set(surface, entry);
  }

  const missingLiterals = new Set<string>();
  for (const entry of resolved.values()) {
    for (const ch of entry.fullKanjiForm ?? "") {
      if (isKanji(ch) && !kanjiInfoCache.has(ch)) missingLiterals.add(ch);
    }
  }
  if (missingLiterals.size > 0) {
    const fetchedKanji = await getKanjiBatchAsync(dictDb, [...missingLiterals]);
    for (const kanji of fetchedKanji) {
      kanjiInfoCache.set(kanji.literal, kanji);
    }
  }

  const kanjiByLiteral = new Map<string, KanjiInfo>();
  for (const entry of resolved.values()) {
    for (const ch of entry.fullKanjiForm ?? "") {
      const kanji = kanjiInfoCache.get(ch);
      if (kanji) kanjiByLiteral.set(ch, kanji);
    }
  }

  for (const [surface, entry] of resolved) {
    if (entry.fullKanjiForm && entry.fullKanaForm) {
      entry.readingPattern = classifyReaderReadingPattern({
        kanjiForm: entry.fullKanjiForm,
        kanaForm: entry.fullKanaForm,
        irregularReading: entry.irregularReading,
        kanjiByLiteral,
      });
    }
    result[surface] = entry;
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
 *
 * Also scans backward from kanji through preceding kana (up to 4 chars) to
 * capture mixed kana-kanji words like しょう油, お寺, ご飯 where the dictionary
 * entry's kanji form uses full kanji (醤油) but the text uses mixed writing.
 */
export function extractSurfacesFromHtml(html: string, kanjiSet: FuriganaKanjiSet): string[] {
  const visibleText = extractVisibleText(html);
  const chars = [...visibleText];
  const seen = new Set<string>();
  const surfaces: string[] = [];

  const addSurfacesFrom = (start: number) => {
    const maxLen = Math.min(chars.length - start, 10);
    for (let len = maxLen; len >= 1; len--) {
      const surface = chars.slice(start, start + len).join("");
      if (seen.has(surface)) continue;
      seen.add(surface);
      surfaces.push(surface);
    }
  };

  for (let i = 0; i < chars.length; i++) {
    if (!isKanji(chars[i]) && !isDigit(chars[i])) continue;

    // For digits, only extract if followed by kanji (counter pattern: １人, ３日)
    if (isDigit(chars[i])) {
      let j = i;
      while (j < chars.length && isDigit(chars[j])) j++;
      if (j >= chars.length || !isKanji(chars[j])) continue;
    }

    // Generate surfaces starting from this position.
    // A word like 反省会 needs to be extracted even if only 省 matches the filter,
    // so the dictionary lookup returns the correct whole-word reading.
    addSurfacesFrom(i);

    // Scan backward through preceding kana (up to 4 chars) to capture
    // mixed kana-kanji words like しょう油, お寺, ご飯.
    let back = i - 1;
    while (back >= 0 && isKana(chars[back]) && i - back <= 4) {
      addSurfacesFrom(back);
      back--;
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

/**
 * Check if a kana character at position `start` is followed by a kanji
 * within the next 4 visible characters. Used to detect mixed kana-kanji
 * words like しょう油 where matching should start at the kana.
 */
function kanaBeforeKanji(html: string, start: number): boolean {
  const chars = getVisibleCharsFrom(html, start);
  // chars[0] is the kana at `start` — check if any of the next 4 chars is kanji
  for (let j = 1; j < Math.min(chars.length, 5); j++) {
    if (isKanji(chars[j])) return true;
    if (!isKana(chars[j])) return false; // hit non-Japanese, stop
  }
  return false;
}

function buildEnabledWordLevels(levels: Record<FuriganaMatchLevel, boolean>): Set<number | null> {
  const enabled = new Set<number | null>();
  for (const [key, isEnabled] of Object.entries(levels) as [FuriganaMatchLevel, boolean][]) {
    if (!isEnabled) continue;
    enabled.add(LEVEL_MAP[key]);
  }
  return enabled;
}

function ruleHasEnabledLevels(levels: Record<FuriganaMatchLevel, boolean>): boolean {
  return Object.values(levels).some(Boolean);
}

function matchesSelectedWordLevel(
  entry: FuriganaEntry,
  enabledLevels: Set<number | null>,
): boolean {
  if (entry.wordJlpt == null) {
    return enabledLevels.has(null);
  }
  return enabledLevels.has(entry.wordJlpt);
}

function shouldShowFuriganaForSurface(
  surfaceChars: string[],
  entry: FuriganaEntry,
  kanjiSet: FuriganaKanjiSet,
  settings: ReaderFuriganaSettings,
): boolean {
  if (entry.isName && !settings.showNames) return false;
  if (entry.isCounter && !settings.showCounters) return false;

  const surfaceKanji = surfaceChars.filter(isKanji);
  const hasSelectedKanji = kanjiSet.all
    ? surfaceKanji.length > 0
    : surfaceKanji.some((c) => kanjiSet.chars.has(c));
  const anyKanjiLevels = settings.ruleLevels.matchAnyKanji;
  const wordLevelSet = buildEnabledWordLevels(settings.ruleLevels.matchWordLevel);
  const irregularLevelSet = buildEnabledWordLevels(settings.ruleLevels.matchIrregularReading);
  const mostlyKunLevelSet = buildEnabledWordLevels(settings.ruleLevels.matchMostlyKunyomi);
  const mostlyOnLevelSet = buildEnabledWordLevels(settings.ruleLevels.matchMostlyOnyomi);
  const mixedLevelSet = buildEnabledWordLevels(settings.ruleLevels.matchMixedOnKun);
  const wordLevelMatches = matchesSelectedWordLevel(entry, wordLevelSet);
  const irregularMatches =
    !!entry.irregularReading && matchesSelectedWordLevel(entry, irregularLevelSet);
  const mostlyKunMatches =
    matchesSelectedWordLevel(entry, mostlyKunLevelSet) && entry.readingPattern === "mostly_kunyomi";
  const mostlyOnMatches =
    matchesSelectedWordLevel(entry, mostlyOnLevelSet) && entry.readingPattern === "mostly_onyomi";
  const mixedMatches =
    matchesSelectedWordLevel(entry, mixedLevelSet) && entry.readingPattern === "mixed_on_kun";

  return (
    entry.isName ||
    entry.isCounter ||
    (ruleHasEnabledLevels(anyKanjiLevels) && hasSelectedKanji) ||
    wordLevelMatches ||
    irregularMatches ||
    mostlyKunMatches ||
    mostlyOnMatches ||
    mixedMatches
  );
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
  settings: ReaderFuriganaSettings = defaultReaderFuriganaSettings,
): string {
  if (furiganaMap.size === 0) return html;

  // Pre-sort map keys by length descending for longest-first matching
  const sortedSurfaces = [...furiganaMap.keys()].sort((a, b) => [...b].length - [...a].length);

  let out = "";
  let i = 0;
  let rubyDepth = 0;
  let rtDepth = 0;
  let blockedVisibleChars = 0;

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

    if (blockedVisibleChars > 0) {
      out += ch;
      i++;
      blockedVisibleChars--;
      continue;
    }

    // Try longest-first match if this char is a kanji, OR if it's kana
    // followed by kanji within 4 chars (mixed kana-kanji words like しょう油).
    // We match at any position, but only emit ruby if the matched word
    // contains at least one kanji from the filter set. This ensures whole-word
    // context-aware readings (e.g. 反省会 gets はんせいかい, not 省=しょう alone).
    const tryMatch = isKanji(ch) || isDigit(ch) || (isKana(ch) && kanaBeforeKanji(html, i));
    if (tryMatch) {
      let matched = false;
      const remaining = getVisibleCharsFrom(html, i);
      let longestRejectedSurfaceChars: string[] | null = null;

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

        if (
          longestRejectedSurfaceChars &&
          (isKanji(longestRejectedSurfaceChars[0]) || isDigit(longestRejectedSurfaceChars[0])) &&
          surfaceChars.length < longestRejectedSurfaceChars.length
        ) {
          const rejectedPrefix = longestRejectedSurfaceChars.slice(0, surfaceChars.length);
          const removedSuffix = longestRejectedSurfaceChars.slice(surfaceChars.length);
          if (rejectedPrefix.join("") === surfaceChars.join("") && removedSuffix.length > 0) {
            continue;
          }
        }

        if (!shouldShowFuriganaForSurface(surfaceChars, entry, kanjiSet, settings)) {
          if (!longestRejectedSurfaceChars) {
            longestRejectedSurfaceChars = surfaceChars;
          }
          continue;
        }

        const baseText = surfaceChars.slice(0, entry.kanjiPartLen).join("");
        out += `<ruby>${baseText}<rt>${entry.reading}</rt></ruby>`;

        // Emit trailing okurigana (chars after kanjiPart within the matched surface)
        if (surfaceChars.length > entry.kanjiPartLen) {
          const trailing = surfaceChars.slice(entry.kanjiPartLen).join("");
          out += trailing;
        }

        // Advance past the matched characters in the raw HTML
        i = advanceHtmlPastChars(html, i, surfaceChars.length);
        matched = true;
        break;
      }

      if (!matched) {
        if (
          longestRejectedSurfaceChars &&
          longestRejectedSurfaceChars.length > 1 &&
          (isKanji(longestRejectedSurfaceChars[0]) || isDigit(longestRejectedSurfaceChars[0]))
        ) {
          blockedVisibleChars = longestRejectedSurfaceChars.length - 1;
        }
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
