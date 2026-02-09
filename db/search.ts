import * as SQLite from "expo-sqlite";
import { toHiragana } from "wanakana";
import type { DictEntry, DictKanji, DictKana, DictSense, Gloss, PitchAccent } from "./types";

// ─── Raw row types ───

interface RawEntryRow {
  entry_id: number;
  priority: number;
  common: number;
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

interface ScoredEntry {
  entryId: number;
  score: number;
}

// ─── Input classification ───

function classifyInput(input: string): { hasJapanese: boolean; isAscii: boolean } {
  let hasJapanese = false,
    isAscii = true;
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x3040 && c <= 0x309f) || // hiragana
      (c >= 0x30a0 && c <= 0x30ff) || // katakana
      (c >= 0x4e00 && c <= 0x9fff) || // CJK unified
      (c >= 0x3400 && c <= 0x4dbf) || // CJK ext A
      (c >= 0xf900 && c <= 0xfaff) || // CJK compat
      (c >= 0x3000 && c <= 0x303f)    // CJK symbols
    ) {
      hasJapanese = true;
      isAscii = false;
    } else if (c < 0x20 || c > 0x7e) {
      isAscii = false;
    }
  }
  return { hasJapanese, isAscii };
}

// ─── Gloss matching ───

function computeGlossBonus(glosses: string, query: string, senseIndex: number, isCommon: boolean): number {
  const senseBonus = senseIndex === 0 ? 3000 : 1000;
  const exactBonus = isCommon ? 5000 : 0;
  try {
    const parsed = JSON.parse(glosses) as { lang: string; text: string }[];
    let best = 0;
    let gi = 0;
    for (const g of parsed) {
      if (g.lang !== "eng") continue;
      const gl = g.text.toLowerCase();
      const isExact = gl === query || gl === "to " + query;
      const isAnnotated =
        !isExact &&
        (gl.startsWith(query + " (") ||
          gl.startsWith(query + "(") ||
          gl.startsWith("to " + query + " (") ||
          gl.startsWith("to " + query + "("));
      if (isExact || isAnnotated) {
        const posFactor = gi === 0 ? 1.0 : 0.5;
        best = Math.max(best, senseBonus + Math.floor(exactBonus * posFactor));
      } else if (
        gl.startsWith(query + " ") ||
        gl.startsWith(query + ",") ||
        gl.startsWith("to " + query + " ") ||
        gl.startsWith("to " + query + ",")
      ) {
        best = Math.max(best, senseBonus);
      }
      gi++;
    }
    return best;
  } catch {}
  return 0;
}

// ─── Search paths ───

async function searchJapanese(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number
): Promise<ScoredEntry[]> {
  const hiragana = toHiragana(input);

  // Step 1: find matching entry IDs via prefix match
  const matchRows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM kanji WHERE text LIKE ?
     UNION
     SELECT DISTINCT entry_id FROM kana WHERE text LIKE ? OR text LIKE ?`,
    [`${input}%`, `${hiragana}%`, `${input}%`]
  );

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  // Step 2: fetch entry metadata
  const entryRows = await db.getAllAsync<RawEntryRow>(
    `SELECT id as entry_id, priority, common FROM entries WHERE id IN (${placeholders})`,
    ids
  );

  // Step 3: check for exact matches
  const [kanjiExact, kanaExact] = await Promise.all([
    db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM kanji WHERE text = ?`,
      [input]
    ),
    db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM kana WHERE text = ? OR text = ?`,
      [hiragana, input]
    ),
  ]);
  const exactSet = new Set([
    ...kanjiExact.map((r) => r.entry_id),
    ...kanaExact.map((r) => r.entry_id),
  ]);

  // Step 4: score
  const results: ScoredEntry[] = entryRows.map((r) => {
    const isExact = exactSet.has(r.entry_id);
    const baseScore = isExact ? 10000 : 5000;
    return {
      entryId: r.entry_id,
      score: baseScore + r.priority + r.common * 50,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

async function searchRomaji(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number
): Promise<ScoredEntry[]> {
  const lower = input.toLowerCase();
  const hiragana = toHiragana(lower);

  // Find matching entries via romaji or kana prefix
  const matchRows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM kana WHERE romaji LIKE ? OR text LIKE ?`,
    [`${lower}%`, `${hiragana}%`]
  );

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  const entryRows = await db.getAllAsync<RawEntryRow>(
    `SELECT id as entry_id, priority, common FROM entries WHERE id IN (${placeholders})`,
    ids
  );

  // Check for exact romaji/kana matches
  const [romajiExact, kanaExact] = await Promise.all([
    db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM kana WHERE romaji = ?`,
      [lower]
    ),
    db.getAllAsync<{ entry_id: number }>(
      `SELECT entry_id FROM kana WHERE text = ?`,
      [hiragana]
    ),
  ]);
  const exactSet = new Set([
    ...romajiExact.map((r) => r.entry_id),
    ...kanaExact.map((r) => r.entry_id),
  ]);

  const results: ScoredEntry[] = entryRows.map((r) => {
    const isExact = exactSet.has(r.entry_id);
    const baseScore = isExact ? 9000 : 4000;
    return {
      entryId: r.entry_id,
      score: baseScore + r.priority + r.common * 50,
    };
  });

  // Sense count tiebreaker: words with more senses are more common/fundamental
  const exactIds = results.filter((r) => r.score >= 9000).map((r) => r.entryId);
  if (exactIds.length > 1) {
    const ph = exactIds.map(() => "?").join(",");
    const senseCounts = await db.getAllAsync<{ entry_id: number; c: number }>(
      `SELECT entry_id, COUNT(*) as c FROM senses WHERE entry_id IN (${ph}) GROUP BY entry_id`,
      exactIds
    );
    const countMap = new Map(senseCounts.map((r) => [r.entry_id, r.c]));
    for (const r of results) {
      if (r.score >= 9000) {
        r.score += Math.min((countMap.get(r.entryId) ?? 0) * 2, 20);
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

let fts5Available: boolean | null = null;

async function searchEnglishFts(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number
): Promise<ScoredEntry[]> {
  const ftsQuery = input
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!ftsQuery) return [];

  const ftsRows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT fts.entry_id, e.priority, e.common
     FROM glosses_fts fts
     JOIN entries e ON fts.entry_id = e.id
     WHERE glosses_fts MATCH ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`"${ftsQuery}"*`, limit * 4]
  );

  return applyGlossBonus(db, ftsRows, input);
}

async function searchEnglishLike(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number
): Promise<ScoredEntry[]> {
  const lowerQuery = input.toLowerCase().replace(/%/g, "").replace(/_/g, "");
  if (!lowerQuery) return [];

  // Use word-boundary patterns to avoid substring noise
  // '% query%' matches query preceded by space (word in a phrase)
  // '%"query%' matches query at start of a JSON text value
  const rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT DISTINCT s.entry_id, e.priority, e.common
     FROM senses s
     JOIN entries e ON s.entry_id = e.id
     WHERE s.glosses LIKE ? OR s.glosses LIKE ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`% ${lowerQuery}%`, `%"${lowerQuery}%`, limit * 4]
  );

  return applyGlossBonus(db, rows, input);
}

async function applyGlossBonus(
  db: SQLite.SQLiteDatabase,
  rows: { entry_id: number; priority: number; common: number }[],
  input: string
): Promise<ScoredEntry[]> {
  const lowerQuery = input.toLowerCase();
  const results: ScoredEntry[] = [];

  for (const r of rows) {
    let bonus = 0;
    const senseRows = await db.getAllAsync<{ glosses: string }>(
      `SELECT glosses FROM senses WHERE entry_id = ?`,
      [r.entry_id]
    );
    for (let si = 0; si < senseRows.length; si++) {
      const b = computeGlossBonus(senseRows[si].glosses, lowerQuery, si, !!r.common);
      bonus = Math.max(bonus, b);
    }
    results.push({
      entryId: r.entry_id,
      score: 2000 + r.priority + r.common * 50 + bonus,
    });
  }

  return results;
}

async function searchEnglish(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number
): Promise<ScoredEntry[]> {
  if (fts5Available === false) {
    return searchEnglishLike(db, input, limit);
  }

  try {
    const results = await searchEnglishFts(db, input, limit);
    fts5Available = true;
    return results;
  } catch (e) {
    if (fts5Available === null && String(e).includes("fts5")) {
      console.warn("FTS5 not available, falling back to LIKE-based English search");
      fts5Available = false;
      return searchEnglishLike(db, input, limit);
    }
    throw e;
  }
}

// ─── Helpers ───

function parseGlosses(raw: string): Gloss[] {
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
    arr.push({ text: r.text, common: !!r.common, tags: parseTags(r.tags) });
    kanjiMap.set(r.entry_id, arr);
  }

  const kanaMap = new Map<number, DictKana[]>();
  for (const r of kanaRows) {
    const arr = kanaMap.get(r.entry_id) ?? [];
    arr.push({ text: r.text, romaji: r.romaji, common: !!r.common, tags: parseTags(r.tags) });
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

// ─── Main search ───

export async function searchDictionary(
  db: SQLite.SQLiteDatabase,
  query: string,
  limit: number = 50
): Promise<DictEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { hasJapanese, isAscii } = classifyInput(trimmed);

  // Run all applicable search paths
  const allResults: ScoredEntry[] = [];

  if (hasJapanese) {
    allResults.push(...(await searchJapanese(db, trimmed, limit)));
  }
  if (isAscii) {
    const [romajiResults, englishResults] = await Promise.all([
      searchRomaji(db, trimmed, limit),
      searchEnglish(db, trimmed, limit),
    ]);
    allResults.push(...romajiResults, ...englishResults);
  }

  // Deduplicate: keep max score per entry
  const scoreMap = new Map<number, number>();
  for (const r of allResults) {
    const existing = scoreMap.get(r.entryId);
    if (existing === undefined || r.score > existing) {
      scoreMap.set(r.entryId, r.score);
    }
  }

  // Sort by score DESC, take top N
  const sorted = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (sorted.length === 0) return [];

  // Fetch full entry data
  const entryIds = sorted.map((s) => s[0]);
  const commonMap = new Map<number, boolean>();

  const placeholders = entryIds.map(() => "?").join(",");

  const [entryRows, kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<{ id: number; common: number }>(
      `SELECT id, common FROM entries WHERE id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawKanjiRow>(
      `SELECT entry_id, text, common, tags FROM kanji WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawKanaRow>(
      `SELECT entry_id, text, romaji, common, tags FROM kana WHERE entry_id IN (${placeholders})`,
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

  for (const r of entryRows) {
    commonMap.set(r.id, !!r.common);
  }

  return assembleEntries(entryIds, kanjiRows, kanaRows, senseRows, pitchRows, commonMap);
}

export async function getEntries(
  db: SQLite.SQLiteDatabase,
  entryIds: number[]
): Promise<DictEntry[]> {
  if (entryIds.length === 0) return [];

  const placeholders = entryIds.map(() => "?").join(",");

  const [entryRows, kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<{ id: number; common: number }>(
      `SELECT id, common FROM entries WHERE id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawKanjiRow>(
      `SELECT entry_id, text, common, tags FROM kanji WHERE entry_id IN (${placeholders})`,
      entryIds
    ),
    db.getAllAsync<RawKanaRow>(
      `SELECT entry_id, text, romaji, common, tags FROM kana WHERE entry_id IN (${placeholders})`,
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

  const commonMap = new Map<number, boolean>();
  for (const r of entryRows) {
    commonMap.set(r.id, !!r.common);
  }

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
      "SELECT entry_id, text, common, tags FROM kanji WHERE entry_id = ?",
      [entryId]
    ),
    db.getAllAsync<RawKanaRow>(
      "SELECT entry_id, text, romaji, common, tags FROM kana WHERE entry_id = ?",
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
