import { type ReaderKanjiCharacter } from "@tradersamwise/jiten-reader-core";
import { toHiragana } from "wanakana";
import type { ReaderSqlDb } from "./backend";
import { isKanjiNumeralRun } from "./numerals";
import type {
  ReaderDictEntry,
  ReaderDictKana,
  ReaderDictKanji,
  ReaderDictSense,
  ReaderGloss,
  ReaderNameEntry,
  ReaderPitchAccent,
} from "./types";

interface RawEntryRow {
  id: number;
  common: number;
  jlpt_level: number | null;
}

interface RawKanjiRow {
  entry_id: number;
  text: string;
  common: number;
  tags: string | null;
}

interface RawKanaRow {
  entry_id: number;
  text: string;
  romaji: string | null;
  common: number;
  tags: string | null;
}

interface RawSenseRow {
  entry_id: number;
  part_of_speech: string | null;
  glosses: string;
  field: string | null;
  misc: string | null;
  info: string | null;
}

interface RawPitchRow {
  entry_id: number;
  reading: string;
  pitch_number: number;
}

interface NameRow {
  id: number;
  kanji: string | null;
  kana: string;
  name_type: string | null;
  translation: string | null;
}

interface KanjiReadingRow {
  literal: string;
  readings_on: string | null;
  readings_kun: string | null;
  nanori: string | null;
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

function normalizeDigitsToKanji(text: string): string {
  return text.replace(/[0-9\uff10-\uff19]/g, (ch) => DIGIT_TO_KANJI[ch] ?? ch);
}

function parseGlosses(raw: string): ReaderGloss[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [{ lang: "eng", text: raw }];
  }
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function parsePOS(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [raw];
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function assembleEntries(
  entryIds: number[],
  kanjiRows: RawKanjiRow[],
  kanaRows: RawKanaRow[],
  senseRows: RawSenseRow[],
  pitchRows: RawPitchRow[],
  commonMap: Map<number, boolean>,
  jlptMap: Map<number, number | null>,
): ReaderDictEntry[] {
  const kanjiMap = new Map<number, ReaderDictKanji[]>();
  for (const row of kanjiRows) {
    const arr = kanjiMap.get(row.entry_id) ?? [];
    arr.push({ text: row.text, common: !!row.common, tags: parseTags(row.tags) });
    kanjiMap.set(row.entry_id, arr);
  }

  const kanaMap = new Map<number, ReaderDictKana[]>();
  for (const row of kanaRows) {
    const arr = kanaMap.get(row.entry_id) ?? [];
    arr.push({
      text: row.text,
      romaji: row.romaji,
      common: !!row.common,
      tags: parseTags(row.tags),
    });
    kanaMap.set(row.entry_id, arr);
  }

  const senseMap = new Map<number, ReaderDictSense[]>();
  for (const row of senseRows) {
    const arr = senseMap.get(row.entry_id) ?? [];
    arr.push({
      partOfSpeech: parsePOS(row.part_of_speech),
      glosses: parseGlosses(row.glosses),
      field: row.field,
      misc: row.misc,
      info: row.info,
    });
    senseMap.set(row.entry_id, arr);
  }

  const pitchMap = new Map<number, ReaderPitchAccent[]>();
  for (const row of pitchRows) {
    const arr = pitchMap.get(row.entry_id) ?? [];
    arr.push({ reading: row.reading, pitchNumber: row.pitch_number });
    pitchMap.set(row.entry_id, arr);
  }

  return entryIds.map((id) => ({
    id,
    common: commonMap.get(id) ?? false,
    jlptLevel: jlptMap.get(id) ?? null,
    kanji: kanjiMap.get(id) ?? [],
    kana: kanaMap.get(id) ?? [],
    senses: senseMap.get(id) ?? [],
    pitchAccents: pitchMap.get(id) ?? [],
  }));
}

async function getEntries(db: ReaderSqlDb, entryIds: number[]): Promise<ReaderDictEntry[]> {
  if (entryIds.length === 0) return [];

  const placeholders = entryIds.map(() => "?").join(",");
  const [entryRows, kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<RawEntryRow>(
      `SELECT id, common, jlpt_level FROM entries WHERE id IN (${placeholders})`,
      entryIds,
    ),
    db.getAllAsync<RawKanjiRow>(
      `SELECT entry_id, text, common, tags FROM kanji WHERE entry_id IN (${placeholders})`,
      entryIds,
    ),
    db.getAllAsync<RawKanaRow>(
      `SELECT entry_id, text, romaji, common, tags FROM kana WHERE entry_id IN (${placeholders})`,
      entryIds,
    ),
    db.getAllAsync<RawSenseRow>(
      `SELECT entry_id, part_of_speech, glosses, field, misc, info FROM senses WHERE entry_id IN (${placeholders})`,
      entryIds,
    ),
    db.getAllAsync<RawPitchRow>(
      `SELECT entry_id, reading, pitch_number FROM pitch_accents WHERE entry_id IN (${placeholders})`,
      entryIds,
    ),
  ]);

  const commonMap = new Map<number, boolean>();
  const jlptMap = new Map<number, number | null>();
  for (const row of entryRows) {
    commonMap.set(row.id, !!row.common);
    jlptMap.set(row.id, row.jlpt_level);
  }

  return assembleEntries(entryIds, kanjiRows, kanaRows, senseRows, pitchRows, commonMap, jlptMap);
}

export async function lookupExactJapanese(
  db: ReaderSqlDb,
  text: string,
): Promise<ReaderDictEntry[]> {
  const hiragana = toHiragana(text);
  const normalized = normalizeDigitsToKanji(text);
  const rows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM (
       SELECT entry_id FROM kanji WHERE text = ? OR text = ?
       UNION
       SELECT entry_id FROM kana WHERE text = ? OR text = ?
     )`,
    [text, normalized, hiragana, text],
  );

  if (rows.length === 0) return [];
  return getEntries(
    db,
    rows.map((row) => row.entry_id),
  );
}

/**
 * Exact lookups for many surfaces in one pass. The tap walk asks about a few
 * hundred candidate spellings and the great majority do not exist at all, so
 * asking one at a time spends most of its queries proving absence. Same
 * matching as lookupExactJapanese, one round trip for the lot.
 */
export async function lookupExactJapaneseMany(
  db: ReaderSqlDb,
  words: readonly string[],
): Promise<Map<string, ReaderDictEntry[]>> {
  const out = new Map<string, ReaderDictEntry[]>();
  const unique = [...new Set(words)];
  if (unique.length === 0) return out;

  const kanjiForms = new Map<string, string[]>();
  const kanaForms = new Map<string, string[]>();
  for (const word of unique) {
    kanjiForms.set(word, [...new Set([word, normalizeDigitsToKanji(word)])]);
    kanaForms.set(word, [...new Set([toHiragana(word), word])]);
  }
  const kanjiSurfaces = [...new Set([...kanjiForms.values()].flat())];
  const kanaSurfaces = [...new Set([...kanaForms.values()].flat())];

  const [kanjiHits, kanaHits] = await Promise.all([
    selectEntryIdsBySurface(db, "kanji", kanjiSurfaces),
    selectEntryIdsBySurface(db, "kana", kanaSurfaces),
  ]);

  const idsByWord = new Map<string, number[]>();
  const wanted = new Set<number>();
  for (const word of unique) {
    const ids = new Set<number>();
    for (const surface of kanjiForms.get(word) ?? []) {
      for (const id of kanjiHits.get(surface) ?? []) ids.add(id);
    }
    for (const surface of kanaForms.get(word) ?? []) {
      for (const id of kanaHits.get(surface) ?? []) ids.add(id);
    }
    if (ids.size === 0) {
      out.set(word, []);
      continue;
    }
    const sorted = [...ids].sort((a, b) => a - b);
    idsByWord.set(word, sorted);
    for (const id of sorted) wanted.add(id);
  }

  const entries = await getEntries(db, [...wanted]);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const [word, ids] of idsByWord) {
    out.set(
      word,
      ids.map((id) => byId.get(id)).filter((entry): entry is ReaderDictEntry => !!entry),
    );
  }
  return out;
}

/** SQLite caps bound parameters, and a tap can ask about a few hundred surfaces. */
const SURFACE_CHUNK = 400;

async function selectEntryIdsBySurface(
  db: ReaderSqlDb,
  table: "kanji" | "kana",
  surfaces: string[],
): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  for (let i = 0; i < surfaces.length; i += SURFACE_CHUNK) {
    const chunk = surfaces.slice(i, i + SURFACE_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.getAllAsync<{ text: string; entry_id: number }>(
      `SELECT text, entry_id FROM ${table} WHERE text IN (${placeholders})`,
      chunk,
    );
    for (const row of rows) {
      const list = found.get(row.text);
      if (list) list.push(row.entry_id);
      else found.set(row.text, [row.entry_id]);
    }
  }
  return found;
}

export async function lookupExactName(db: ReaderSqlDb, text: string): Promise<ReaderNameEntry[]> {
  if (!text) return [];
  // 四十三 and 五十八 are given names in JMnedict and numbers everywhere else, so
  // in running prose a run written only in numerals is never a name.
  if (isKanjiNumeralRun(text)) return [];
  try {
    const hiragana = toHiragana(text);
    const rows = await db.getAllAsync<NameRow>(
      `SELECT id, kanji, kana, name_type, translation FROM names
       WHERE kanji = ? OR kana = ? OR kana = ?
       LIMIT 20`,
      [text, text, hiragana],
    );
    return rows.map((row) => ({
      id: row.id,
      kanji: row.kanji,
      kana: row.kana,
      nameType: row.name_type,
      translation: row.translation,
    }));
  } catch {
    return [];
  }
}

export async function getKanjiAsync(
  db: ReaderSqlDb,
  literal: string,
): Promise<ReaderKanjiCharacter | null> {
  const row = await db.getFirstAsync<KanjiReadingRow>(
    "SELECT literal, readings_on, readings_kun, nanori FROM kanji_characters WHERE literal = ?",
    [literal],
  );
  if (!row) return null;
  return {
    literal: row.literal,
    readingsOn: parseStringArray(row.readings_on),
    readingsKun: parseStringArray(row.readings_kun),
    nanori: parseStringArray(row.nanori),
  };
}
