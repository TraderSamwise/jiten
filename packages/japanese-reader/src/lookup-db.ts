import { type ReaderKanjiCharacter } from "@jiten/japanese-reader-core";
import { toHiragana } from "wanakana";
import type { ReaderSqlDb } from "./backend";
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

export async function lookupExactName(db: ReaderSqlDb, text: string): Promise<ReaderNameEntry[]> {
  if (!text) return [];
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
