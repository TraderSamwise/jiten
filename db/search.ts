import * as SQLite from "expo-sqlite";
import { toHiragana } from "wanakana";
import type {
  DictEntry,
  DictKanji,
  DictKana,
  DictSense,
  Gloss,
  PitchAccent,
  SearchResults,
  EnglishMatchEntry,
} from "./types";

// ─── Raw row types ───

interface RawEntryRow {
  entry_id: number;
  priority: number;
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

interface ScoredEntry {
  entryId: number;
  score: number;
  matchedGloss?: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "up",
  "or",
  "and",
  "is",
  "be",
  "as",
  "it",
  "not",
  "no",
]);

/** Crude stemming for LIKE search: drop last char so "starve" → "starv" matches "starving" */
function stemForLike(word: string): string {
  const w = word.toLowerCase().replace(/%/g, "").replace(/_/g, "");
  if (w.length >= 5) return w.slice(0, -1);
  return w;
}

/** Look up synonyms for a list of words from the synonyms table.
 *  maxPerWord caps synonyms per word to keep LIKE queries fast. */
async function expandWithSynonyms(
  db: SQLite.SQLiteDatabase,
  words: string[],
  maxPerWord: number = 8,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (words.length === 0) return map;
  for (const w of words) map.set(w.toLowerCase(), []);

  try {
    const placeholders = words.map(() => "?").join(",");
    const rows = await db.getAllAsync<{ word: string; synonym: string }>(
      `SELECT word, synonym FROM synonyms WHERE word IN (${placeholders})`,
      words.map((w) => w.toLowerCase()),
    );
    for (const r of rows) {
      const arr = map.get(r.word);
      if (arr && arr.length < maxPerWord) {
        arr.push(r.synonym);
      }
    }
  } catch {
    // No synonyms table — skip expansion
  }

  return map;
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
      (c >= 0x3000 && c <= 0x303f) // CJK symbols
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

function computeGlossBonus(
  glosses: string,
  query: string,
  senseIndex: number,
  isCommon: boolean,
): { score: number; matchedGloss: string | null } {
  const senseBonus = senseIndex === 0 ? 3000 : 1000;
  const exactBonus = isCommon ? 5000 : 0;
  try {
    const parsed = JSON.parse(glosses) as { lang: string; text: string }[];
    let best = 0;
    let bestGloss: string | null = null;
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
        const s = senseBonus + Math.floor(exactBonus * posFactor);
        if (s > best) {
          best = s;
          bestGloss = g.text;
        }
      } else if (
        gl.startsWith(query + " ") ||
        gl.startsWith(query + ",") ||
        gl.startsWith("to " + query + " ") ||
        gl.startsWith("to " + query + ",")
      ) {
        if (senseBonus > best) {
          best = senseBonus;
          bestGloss = g.text;
        }
      }
      gi++;
    }
    return { score: best, matchedGloss: bestGloss };
  } catch {}
  return { score: 0, matchedGloss: null };
}

/** Find the first English gloss that contains the query (fallback for tier 3 / OR results). */
function findFirstMatchingGloss(entry: DictEntry, query: string): string {
  const lq = query.toLowerCase();
  for (const sense of entry.senses) {
    for (const g of sense.glosses) {
      if (g.lang === "eng" && g.text.toLowerCase().includes(lq)) {
        return g.text;
      }
    }
  }
  // Ultimate fallback: first English gloss
  for (const sense of entry.senses) {
    for (const g of sense.glosses) {
      if (g.lang === "eng") return g.text;
    }
  }
  return "";
}

// ─── Search paths ───

async function searchJapanese(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number,
): Promise<ScoredEntry[]> {
  const hiragana = toHiragana(input);

  // Step 1: find matching entry IDs via prefix match (cap at 500 to stay within SQL variable limits)
  const matchRows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM (
       SELECT entry_id FROM kanji WHERE text LIKE ?
       UNION
       SELECT entry_id FROM kana WHERE text LIKE ? OR text LIKE ?
     ) LIMIT 500`,
    [`${input}%`, `${hiragana}%`, `${input}%`],
  );

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  // Step 2: fetch entry metadata
  const entryRows = await db.getAllAsync<RawEntryRow>(
    `SELECT id as entry_id, priority, common FROM entries WHERE id IN (${placeholders})`,
    ids,
  );

  // Step 3: check for exact matches
  const [kanjiExact, kanaExact] = await Promise.all([
    db.getAllAsync<{ entry_id: number }>(`SELECT entry_id FROM kanji WHERE text = ?`, [input]),
    db.getAllAsync<{ entry_id: number }>(`SELECT entry_id FROM kana WHERE text = ? OR text = ?`, [
      hiragana,
      input,
    ]),
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
  limit: number,
): Promise<ScoredEntry[]> {
  const lower = input.toLowerCase();
  const hiragana = toHiragana(lower);

  // Find matching entries via romaji or kana prefix (cap at 500 to stay within SQL variable limits)
  const matchRows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM kana WHERE romaji LIKE ? OR text LIKE ? LIMIT 500`,
    [`${lower}%`, `${hiragana}%`],
  );

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  const entryRows = await db.getAllAsync<RawEntryRow>(
    `SELECT id as entry_id, priority, common FROM entries WHERE id IN (${placeholders})`,
    ids,
  );

  // Check for exact romaji/kana matches
  const [romajiExact, kanaExact] = await Promise.all([
    db.getAllAsync<{ entry_id: number }>(`SELECT entry_id FROM kana WHERE romaji = ?`, [lower]),
    db.getAllAsync<{ entry_id: number }>(`SELECT entry_id FROM kana WHERE text = ?`, [hiragana]),
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
      exactIds,
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
let hasJlptColumn: boolean | null = null;

/** SELECT from entries with graceful fallback if jlpt_level column doesn't exist (old DB). */
async function queryEntryRows(
  db: SQLite.SQLiteDatabase,
  whereClause: string,
  params: any[],
): Promise<{ id: number; common: number; jlpt_level: number | null }[]> {
  if (hasJlptColumn !== false) {
    try {
      const rows = await db.getAllAsync<{ id: number; common: number; jlpt_level: number | null }>(
        `SELECT id, common, jlpt_level FROM entries WHERE ${whereClause}`,
        params,
      );
      hasJlptColumn = true;
      return rows;
    } catch (e) {
      if (hasJlptColumn === null && String(e).includes("jlpt_level")) {
        hasJlptColumn = false;
      } else {
        throw e;
      }
    }
  }
  // Fallback: no jlpt_level column
  const rows = await db.getAllAsync<{ id: number; common: number }>(
    `SELECT id, common FROM entries WHERE ${whereClause}`,
    params,
  );
  return rows.map((r) => ({ ...r, jlpt_level: null }));
}

async function searchEnglishFts(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number,
): Promise<ScoredEntry[]> {
  const cleaned = input.replace(/['"]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const seenIds = new Set<number>();
  const allResults: ScoredEntry[] = [];

  // Tier 0: Exact word match — ensures entries with the exact token (e.g. "go")
  // aren't drowned out by prefix matches ("go*" → good, going, government, ...)
  const tier0Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT fts.entry_id, e.priority, e.common
     FROM glosses_fts fts
     JOIN entries e ON fts.entry_id = e.id
     WHERE glosses_fts MATCH ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`"${cleaned}"`, limit * 2],
  );
  const tier0 = await applyGlossBonus(db, tier0Rows, input, 1500);
  for (const r of tier0) {
    seenIds.add(r.entryId);
    allResults.push(r);
  }

  // Tier 1: Phrase prefix match (broader — catches partial word matches)
  const tier1Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT fts.entry_id, e.priority, e.common
     FROM glosses_fts fts
     JOIN entries e ON fts.entry_id = e.id
     WHERE glosses_fts MATCH ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`"${cleaned}"*`, limit * 4],
  );
  const tier1 = await applyGlossBonus(db, tier1Rows, input, 1000);
  for (const r of tier1) {
    if (!seenIds.has(r.entryId)) {
      seenIds.add(r.entryId);
      allResults.push(r);
    }
  }

  // Tier 2: AND of content words (only for multi-word queries)
  const contentWords = cleaned.split(" ").filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  if (contentWords.length > 1) {
    const andQuery = contentWords.map((w) => `"${w}"*`).join(" AND ");
    const tier2Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
      `SELECT fts.entry_id, e.priority, e.common
       FROM glosses_fts fts
       JOIN entries e ON fts.entry_id = e.id
       WHERE glosses_fts MATCH ?
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
      [andQuery, limit * 4],
    );
    const tier2 = await applyGlossBonus(db, tier2Rows, input, 500);
    for (const r of tier2) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  // Tier 2.5: Synonym-expanded AND
  const synMap = await expandWithSynonyms(db, contentWords);
  if (contentWords.length > 0) {
    const groupQueries = contentWords.map((w) => {
      const syns = synMap.get(w.toLowerCase()) ?? [];
      const all = [w, ...syns];
      if (all.length === 1) return `"${all[0]}"*`;
      return "(" + all.map((s) => `"${s}"*`).join(" OR ") + ")";
    });
    const synQuery = groupQueries.join(" AND ");
    try {
      const tier25Rows = await db.getAllAsync<{
        entry_id: number;
        priority: number;
        common: number;
      }>(
        `SELECT fts.entry_id, e.priority, e.common
         FROM glosses_fts fts
         JOIN entries e ON fts.entry_id = e.id
         WHERE glosses_fts MATCH ?
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
        [synQuery, limit * 4],
      );
      const tier25 = await applyGlossBonus(db, tier25Rows, input, 250);
      for (const r of tier25) {
        if (!seenIds.has(r.entryId)) {
          seenIds.add(r.entryId);
          allResults.push(r);
        }
      }
    } catch {}
  }

  // Tier 3: OR fallback (only if tiers 1+2 returned < 5 results)
  if (allResults.length < 5 && contentWords.length > 1) {
    const orQuery = contentWords.map((w) => `"${w}"*`).join(" OR ");
    const tier3Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
      `SELECT fts.entry_id, e.priority, e.common
       FROM glosses_fts fts
       JOIN entries e ON fts.entry_id = e.id
       WHERE glosses_fts MATCH ?
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
      [orQuery, limit * 4],
    );
    const tier3 = await applyGlossBonus(db, tier3Rows, input, 0);
    for (const r of tier3) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  return allResults;
}

async function searchEnglishLike(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number,
): Promise<ScoredEntry[]> {
  const cleaned = input
    .toLowerCase()
    .replace(/%/g, "")
    .replace(/_/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const seenIds = new Set<number>();
  const allResults: ScoredEntry[] = [];

  // Tier 0: Exact word LIKE — ensures entries with the exact word aren't
  // drowned by prefix matches (e.g. "go" vs "good", "going", ...)
  const tier0Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT DISTINCT s.entry_id, e.priority, e.common
     FROM senses s
     JOIN entries e ON s.entry_id = e.id
     WHERE s.glosses LIKE ? OR s.glosses LIKE ? OR s.glosses LIKE ? OR s.glosses LIKE ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`%"${cleaned}"%`, `%"${cleaned}",%`, `% ${cleaned} %`, `% ${cleaned},%`, limit * 2],
  );
  const tier0 = await applyGlossBonus(db, tier0Rows, input, 1500);
  for (const r of tier0) {
    seenIds.add(r.entryId);
    allResults.push(r);
  }

  // Tier 1: Full phrase LIKE (word-boundary prefix match)
  const tier1Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
    `SELECT DISTINCT s.entry_id, e.priority, e.common
     FROM senses s
     JOIN entries e ON s.entry_id = e.id
     WHERE s.glosses LIKE ? OR s.glosses LIKE ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT ?`,
    [`% ${cleaned}%`, `%"${cleaned}%`, limit * 4],
  );
  const tier1 = await applyGlossBonus(db, tier1Rows, input, 1000);
  for (const r of tier1) {
    if (!seenIds.has(r.entryId)) {
      seenIds.add(r.entryId);
      allResults.push(r);
    }
  }

  // Tier 2: AND of stemmed content words
  const contentWords = cleaned.split(" ").filter((w) => !STOP_WORDS.has(w));
  if (contentWords.length > 1) {
    const stems = contentWords.map(stemForLike);
    const likePatterns = stems.map((s) => `%${s}%`);
    const whereClause = stems.map(() => "s.glosses LIKE ?").join(" OR ");
    const havingClause = stems
      .map(() => "SUM(CASE WHEN s.glosses LIKE ? THEN 1 ELSE 0 END) > 0")
      .join(" AND ");

    const tier2Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
      `SELECT s.entry_id, e.priority, e.common
       FROM senses s
       JOIN entries e ON s.entry_id = e.id
       WHERE ${whereClause}
       GROUP BY s.entry_id, e.priority, e.common
       HAVING ${havingClause}
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
      [...likePatterns, ...likePatterns, limit * 4],
    );
    const tier2 = await applyGlossBonus(db, tier2Rows, input, 500);
    for (const r of tier2) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  // Tier 2.5: Synonym-expanded AND (LIKE)
  const synMapLike = await expandWithSynonyms(db, contentWords, 15);
  if (contentWords.length > 0) {
    const groups = contentWords.map((w) => {
      const syns = synMapLike.get(w.toLowerCase()) ?? [];
      // Use stemmed original word + full synonym words (synonyms are already canonical forms).
      // Filter out very short synonyms (<=3 chars) to avoid excessive LIKE false positives.
      const parts: string[] = [stemForLike(w)];
      for (const s of syns) {
        if (s.length > 3 && !parts.includes(s)) parts.push(s);
      }
      return parts;
    });
    // WHERE: any group's pattern matches (for efficient index use)
    const allPatterns: string[] = [];
    const whereTerms: string[] = [];
    for (const group of groups) {
      const groupPatterns = group.map((s) => `%${s}%`);
      allPatterns.push(...groupPatterns);
      whereTerms.push(group.map(() => "s.glosses LIKE ?").join(" OR "));
    }
    const whereClause = whereTerms.map((t) => `(${t})`).join(" OR ");
    // HAVING: all groups must match
    const havingTerms: string[] = [];
    const havingPatterns: string[] = [];
    for (const group of groups) {
      const groupPatterns = group.map((s) => `%${s}%`);
      havingPatterns.push(...groupPatterns);
      havingTerms.push(
        "(" + group.map(() => "CASE WHEN s.glosses LIKE ? THEN 1 ELSE 0 END").join(" + ") + ") > 0",
      );
    }
    const havingClause = havingTerms.join(" AND ");

    try {
      const tier25Rows = await db.getAllAsync<{
        entry_id: number;
        priority: number;
        common: number;
      }>(
        `SELECT s.entry_id, e.priority, e.common
         FROM senses s
         JOIN entries e ON s.entry_id = e.id
         WHERE ${whereClause}
         GROUP BY s.entry_id, e.priority, e.common
         HAVING ${havingClause}
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
        [...allPatterns, ...havingPatterns, limit * 4],
      );
      const tier25 = await applyGlossBonus(db, tier25Rows, input, 250);
      for (const r of tier25) {
        if (!seenIds.has(r.entryId)) {
          seenIds.add(r.entryId);
          allResults.push(r);
        }
      }
    } catch {}
  }

  // Tier 3: OR of stemmed content words (only if < 5 results)
  if (allResults.length < 5 && contentWords.length > 1) {
    const stems = contentWords.map(stemForLike);
    const likePatterns = stems.map((s) => `%${s}%`);
    const whereClause = stems.map(() => "s.glosses LIKE ?").join(" OR ");

    const tier3Rows = await db.getAllAsync<{ entry_id: number; priority: number; common: number }>(
      `SELECT DISTINCT s.entry_id, e.priority, e.common
       FROM senses s
       JOIN entries e ON s.entry_id = e.id
       WHERE ${whereClause}
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
      [...likePatterns, limit * 4],
    );
    const tier3 = await applyGlossBonus(db, tier3Rows, input, 0);
    for (const r of tier3) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  return allResults;
}

async function applyGlossBonus(
  db: SQLite.SQLiteDatabase,
  rows: { entry_id: number; priority: number; common: number }[],
  input: string,
  tierBonus: number = 0,
): Promise<ScoredEntry[]> {
  const lowerQuery = input.toLowerCase();
  const results: ScoredEntry[] = [];

  for (const r of rows) {
    let bonus = 0;
    let matchedGloss: string | null = null;
    const senseRows = await db.getAllAsync<{ glosses: string }>(
      `SELECT glosses FROM senses WHERE entry_id = ?`,
      [r.entry_id],
    );
    for (let si = 0; si < senseRows.length; si++) {
      const result = computeGlossBonus(senseRows[si].glosses, lowerQuery, si, !!r.common);
      if (result.score > bonus) {
        bonus = result.score;
        matchedGloss = result.matchedGloss;
      }
    }
    results.push({
      entryId: r.entry_id,
      score: 2000 + r.priority + r.common * 50 + bonus + tierBonus,
      matchedGloss: matchedGloss ?? undefined,
    });
  }

  return results;
}

async function searchEnglish(
  db: SQLite.SQLiteDatabase,
  input: string,
  limit: number,
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
  commonMap: Map<number, boolean>,
  jlptMap: Map<number, number | null>,
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
    jlptLevel: jlptMap.get(id) ?? null,
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
  limit: number = 50,
): Promise<SearchResults> {
  const trimmed = query.trim();
  if (!trimmed) return { japanese: [], english: [] };

  const { hasJapanese, isAscii } = classifyInput(trimmed);

  // Collect results by category
  const japaneseResults: ScoredEntry[] = [];
  const englishResults: ScoredEntry[] = [];

  if (hasJapanese) {
    japaneseResults.push(...(await searchJapanese(db, trimmed, limit)));
  }
  if (isAscii) {
    const [romajiResults, engResults] = await Promise.all([
      searchRomaji(db, trimmed, limit),
      searchEnglish(db, trimmed, limit),
    ]);
    japaneseResults.push(...romajiResults);
    englishResults.push(...engResults);
  }

  // Deduplicate within each group (keep max score per entry)
  const dedup = (entries: ScoredEntry[]): ScoredEntry[] => {
    const bestMap = new Map<number, ScoredEntry>();
    for (const r of entries) {
      const existing = bestMap.get(r.entryId);
      if (!existing || r.score > existing.score) {
        bestMap.set(r.entryId, r);
      }
    }
    return [...bestMap.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  };

  const japSorted = dedup(japaneseResults);
  const engSorted = dedup(englishResults);

  // Gather all unique entry IDs to fetch
  const allIds = new Set([...japSorted.map((r) => r.entryId), ...engSorted.map((r) => r.entryId)]);

  if (allIds.size === 0) return { japanese: [], english: [] };

  const entryIds = [...allIds];
  const placeholders = entryIds.map(() => "?").join(",");

  const [entryRows, kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    queryEntryRows(db, `id IN (${placeholders})`, entryIds),
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
  for (const r of entryRows) {
    commonMap.set(r.id, !!r.common);
    jlptMap.set(r.id, r.jlpt_level);
  }

  // Build a lookup map of assembled entries
  const allAssembled = assembleEntries(
    entryIds,
    kanjiRows,
    kanaRows,
    senseRows,
    pitchRows,
    commonMap,
    jlptMap,
  );
  const entryMap = new Map<number, DictEntry>();
  for (const e of allAssembled) {
    entryMap.set(e.id, e);
  }

  // Map scored lists to DictEntry arrays, preserving sort order
  const toEntries = (scored: ScoredEntry[]): DictEntry[] =>
    scored.map((r) => entryMap.get(r.entryId)!).filter(Boolean);

  // Build englishMatches with matched gloss text
  // For ASCII input, merge romaji results into the same pool so everything
  // appears in one unified, ranked gloss-group list
  const lowerQuery = trimmed.toLowerCase();
  let allMatchSources: ScoredEntry[];
  if (isAscii && japSorted.length > 0) {
    // Cross-category pruning: when both romaji and English have results,
    // drop low-scoring entries from either category if the other scores
    // much higher. Keeps high scorers from both, removes noise.
    let prunedJap = japSorted;
    let prunedEng = engSorted;
    if (japSorted.length > 0 && engSorted.length > 0) {
      const overallMax = Math.max(japSorted[0].score, engSorted[0].score);
      const threshold = overallMax * 0.4;
      prunedJap = japSorted.filter((r) => r.score >= threshold);
      prunedEng = engSorted.filter((r) => r.score >= threshold);
    }

    const merged = new Map<number, ScoredEntry>();
    for (const r of prunedEng) {
      merged.set(r.entryId, r);
    }
    for (const r of prunedJap) {
      const existing = merged.get(r.entryId);
      if (!existing || r.score > existing.score) {
        merged.set(r.entryId, {
          ...r,
          matchedGloss: r.matchedGloss ?? existing?.matchedGloss,
        });
      }
    }
    allMatchSources = [...merged.values()].sort((a, b) => b.score - a.score);
  } else {
    allMatchSources = engSorted;
  }

  const englishMatches: EnglishMatchEntry[] = allMatchSources
    .map((r) => {
      const entry = entryMap.get(r.entryId);
      if (!entry) return null;
      const gloss = r.matchedGloss ?? findFirstMatchingGloss(entry, lowerQuery);
      return { entry, matchedGloss: gloss };
    })
    .filter((m): m is EnglishMatchEntry => m !== null);

  return {
    japanese: toEntries(japSorted),
    english: toEntries(engSorted),
    englishMatches,
  };
}

/**
 * Fast exact-match Japanese lookup for reader mode.
 * Only does `WHERE text = ?` on kanji/kana tables — no prefix matching,
 * no English/romaji search, no synonym expansion, no scoring.
 */
export async function lookupExactJapanese(
  db: SQLite.SQLiteDatabase,
  text: string,
): Promise<DictEntry[]> {
  const hiragana = toHiragana(text);

  const rows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT entry_id FROM (
       SELECT entry_id FROM kanji WHERE text = ?
       UNION
       SELECT entry_id FROM kana WHERE text = ? OR text = ?
     )`,
    [text, hiragana, text],
  );

  if (rows.length === 0) return [];

  return getEntries(
    db,
    rows.map((r) => r.entry_id),
  );
}

export async function getEntries(
  db: SQLite.SQLiteDatabase,
  entryIds: number[],
): Promise<DictEntry[]> {
  if (entryIds.length === 0) return [];

  const placeholders = entryIds.map(() => "?").join(",");

  const [entryRows, kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    queryEntryRows(db, `id IN (${placeholders})`, entryIds),
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
  for (const r of entryRows) {
    commonMap.set(r.id, !!r.common);
    jlptMap.set(r.id, r.jlpt_level);
  }

  return assembleEntries(entryIds, kanjiRows, kanaRows, senseRows, pitchRows, commonMap, jlptMap);
}

export async function getWordsForKanjiAsync(
  db: SQLite.SQLiteDatabase,
  kanjiChar: string,
): Promise<DictEntry[]> {
  const rows = await db.getAllAsync<{ entry_id: number }>(
    `SELECT DISTINCT k.entry_id
     FROM kanji k
     JOIN entries e ON k.entry_id = e.id
     WHERE k.text LIKE ?
     ORDER BY e.priority + (e.common * 50) DESC
     LIMIT 30`,
    [`%${kanjiChar}%`],
  );

  if (rows.length === 0) return [];

  return getEntries(
    db,
    rows.map((r) => r.entry_id),
  );
}

export async function getEntry(
  db: SQLite.SQLiteDatabase,
  entryId: number,
): Promise<DictEntry | null> {
  const entryRows = await queryEntryRows(db, "id = ?", [entryId]);
  const row = entryRows[0];
  if (!row) return null;

  const [kanjiRows, kanaRows, senseRows, pitchRows] = await Promise.all([
    db.getAllAsync<RawKanjiRow>(
      "SELECT entry_id, text, common, tags FROM kanji WHERE entry_id = ?",
      [entryId],
    ),
    db.getAllAsync<RawKanaRow>(
      "SELECT entry_id, text, romaji, common, tags FROM kana WHERE entry_id = ?",
      [entryId],
    ),
    db.getAllAsync<RawSenseRow>(
      "SELECT entry_id, part_of_speech, glosses, field, misc, info FROM senses WHERE entry_id = ?",
      [entryId],
    ),
    db.getAllAsync<RawPitchRow>(
      "SELECT entry_id, reading, pitch_number FROM pitch_accents WHERE entry_id = ?",
      [entryId],
    ),
  ]);

  const commonMap = new Map([[row.id, !!row.common]]);
  const jlptMap = new Map<number, number | null>([[row.id, row.jlpt_level]]);
  const entries = assembleEntries(
    [row.id],
    kanjiRows,
    kanaRows,
    senseRows,
    pitchRows,
    commonMap,
    jlptMap,
  );
  return entries[0] ?? null;
}
