import * as SQLite from "expo-sqlite";
import { toHiragana, isRomaji, isJapanese } from "wanakana";
import type { DictEntry, DictKanji, DictKana, DictSense, Gloss, PitchAccent } from "./types";

interface RawSearchRow {
  entry_id: number;
  entry_common: number;
}

interface RawKanjiRow {
  entry_id: number;
  text: string;
  common: number;
}

interface RawKanaRow {
  entry_id: number;
  text: string;
  romaji: string | null;
  common: number;
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

function parseGlosses(raw: string): Gloss[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [{ lang: "eng", text: raw }];
  }
}

function parsePOS(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return raw ? [raw] : [];
  }
}

function assembleEntries(
  entryIds: number[],
  kanjiRows: RawKanjiRow[],
  kanaRows: RawKanaRow[],
  senseRows: RawSenseRow[],
  pitchRows: RawPitchRow[],
  commonMap: Map<number, boolean>
): DictEntry[] {
  const kanjiMap = new Map<number, DictKanji[]>();
  for (const r of kanjiRows) {
    const arr = kanjiMap.get(r.entry_id) ?? [];
    arr.push({ text: r.text, common: !!r.common });
    kanjiMap.set(r.entry_id, arr);
  }

  const kanaMap = new Map<number, DictKana[]>();
  for (const r of kanaRows) {
    const arr = kanaMap.get(r.entry_id) ?? [];
    arr.push({ text: r.text, romaji: r.romaji, common: !!r.common });
    kanaMap.set(r.entry_id, arr);
  }

  const senseMap = new Map<number, DictSense[]>();
  for (const r of senseRows) {
    const arr = senseMap.get(r.entry_id) ?? [];
    arr.push({
      partOfSpeech: parsePOS(r.part_of_speech),
      glosses: parseGlosses(r.glosses),
      field: r.field,
      misc: r.misc,
      info: r.info,
    });
    senseMap.set(r.entry_id, arr);
  }

  const pitchMap = new Map<number, PitchAccent[]>();
  for (const r of pitchRows) {
    const arr = pitchMap.get(r.entry_id) ?? [];
    arr.push({ reading: r.reading, pitchNumber: r.pitch_number });
    pitchMap.set(r.entry_id, arr);
  }

  return entryIds.map((id) => ({
    id,
    common: commonMap.get(id) ?? false,
    kanji: kanjiMap.get(id) ?? [],
    kana: kanaMap.get(id) ?? [],
    senses: senseMap.get(id) ?? [],
    pitchAccents: pitchMap.get(id) ?? [],
  }));
}

export async function searchDictionary(
  db: SQLite.SQLiteDatabase,
  query: string,
  limit: number = 50
): Promise<DictEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let entryIds: number[] = [];
  const commonMap = new Map<number, boolean>();

  if (isRomaji(trimmed)) {
    // Convert romaji to hiragana and search kana
    const hiragana = toHiragana(trimmed);
    const rows = await db.getAllAsync<RawSearchRow>(
      `SELECT DISTINCT e.id as entry_id, e.common as entry_common
       FROM kana k JOIN entries e ON k.entry_id = e.id
       WHERE k.text LIKE ? OR k.romaji LIKE ?
       ORDER BY e.common DESC, length(k.text) ASC
       LIMIT ?`,
      [`${hiragana}%`, `${trimmed.toLowerCase()}%`, limit]
    );
    for (const r of rows) {
      entryIds.push(r.entry_id);
      commonMap.set(r.entry_id, !!r.entry_common);
    }
  } else if (isJapanese(trimmed)) {
    // Search kanji and kana tables
    const hiragana = toHiragana(trimmed);
    const rows = await db.getAllAsync<RawSearchRow>(
      `SELECT DISTINCT e.id as entry_id, e.common as entry_common FROM (
        SELECT entry_id FROM kanji WHERE text LIKE ?
        UNION
        SELECT entry_id FROM kana WHERE text LIKE ?
       ) matches JOIN entries e ON matches.entry_id = e.id
       ORDER BY e.common DESC
       LIMIT ?`,
      [`${trimmed}%`, `${hiragana}%`, limit]
    );
    for (const r of rows) {
      entryIds.push(r.entry_id);
      commonMap.set(r.entry_id, !!r.entry_common);
    }
  } else {
    // English search via FTS
    const ftsQuery = trimmed.replace(/['"]/g, "").replace(/\s+/g, " ");
    const rows = await db.getAllAsync<RawSearchRow>(
      `SELECT DISTINCT e.id as entry_id, e.common as entry_common
       FROM glosses_fts fts JOIN entries e ON fts.entry_id = e.id
       WHERE glosses_fts MATCH ?
       ORDER BY e.common DESC
       LIMIT ?`,
      [`"${ftsQuery}"*`, limit]
    );
    for (const r of rows) {
      entryIds.push(r.entry_id);
      commonMap.set(r.entry_id, !!r.entry_common);
    }
  }

  if (entryIds.length === 0) return [];

  const placeholders = entryIds.map(() => "?").join(",");

  const [kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<RawKanjiRow>(
      `SELECT entry_id, text, common FROM kanji WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawKanaRow>(
      `SELECT entry_id, text, romaji, common FROM kana WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawSenseRow>(
      `SELECT entry_id, part_of_speech, glosses, field, misc, info FROM senses WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawPitchRow>(
      `SELECT entry_id, reading, pitch_number FROM pitch_accents WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
  ]);

  return assembleEntries(entryIds, kanjiRows, kanaRows, senseRows, pitchRows, commonMap);
}

export async function getEntry(
  db: SQLite.SQLiteDatabase,
  entryId: number
): Promise<DictEntry | null> {
  const row = await db.getFirstAsync<{ id: number; common: number }>(
    "SELECT id, common FROM entries WHERE id = ?",
    [entryId]
  );
  if (!row) return null;

  const [kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<RawKanjiRow>(
      "SELECT entry_id, text, common FROM kanji WHERE entry_id = ?",
      [entryId]
    ),
    db.getAllAsync<RawKanaRow>(
      "SELECT entry_id, text, romaji, common FROM kana WHERE entry_id = ?",
      [entryId]
    ),
    db.getAllAsync<RawSenseRow>(
      "SELECT entry_id, part_of_speech, glosses, field, misc, info FROM senses WHERE entry_id = ?",
      [entryId]
    ),
    db.getAllAsync<RawPitchRow>(
      "SELECT entry_id, reading, pitch_number FROM pitch_accents WHERE entry_id = ?",
      [entryId]
    ),
  ]);

  const commonMap = new Map([[row.id, !!row.common]]);
  const entries = assembleEntries(
    [row.id],
    kanjiRows,
    kanaRows,
    senseRows,
    pitchRows,
    commonMap
  );
  return entries[0] ?? null;
}
