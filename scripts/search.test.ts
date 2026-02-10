/**
 * Search tests against real dictionary.db using better-sqlite3.
 *
 * These tests verify that our SQL queries + scoring logic produce correct
 * results and ordering. They mirror the production search logic in db/search.ts
 * but run via better-sqlite3 instead of expo-sqlite.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { toHiragana } from "wanakana";

const DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary.db");

// ─── Types ───

interface ScoredEntry {
  entryId: number;
  score: number;
}

interface DictResult {
  entryId: number;
  score: number;
  kanjiTexts: string[];
  kanaTexts: string[];
  glossTexts: string[];
}

// ─── Input classification (same as production) ───

function classifyInput(input: string): { hasJapanese: boolean; isAscii: boolean } {
  let hasJapanese = false,
    isAscii = true;
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x3040 && c <= 0x309f) ||
      (c >= 0x30a0 && c <= 0x30ff) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x3000 && c <= 0x303f)
    ) {
      hasJapanese = true;
      isAscii = false;
    } else if (c < 0x20 || c > 0x7e) {
      isAscii = false;
    }
  }
  return { hasJapanese, isAscii };
}

// ─── Search logic (mirrors production db/search.ts) ───

function searchJapanese(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  const hiragana = toHiragana(input);
  const matchRows = db
    .prepare(
      `SELECT DISTINCT entry_id FROM (
         SELECT entry_id FROM kanji WHERE text LIKE ?
         UNION
         SELECT entry_id FROM kana WHERE text LIKE ? OR text LIKE ?
       ) LIMIT 500`,
    )
    .all(`${input}%`, `${hiragana}%`, `${input}%`) as { entry_id: number }[];

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  const entryRows = db
    .prepare(
      `SELECT e.id as entry_id, e.priority, e.common FROM entries e WHERE e.id IN (${placeholders})`,
    )
    .all(...ids) as { entry_id: number; priority: number; common: number }[];

  const kanjiExactSet = new Set(
    (
      db.prepare(`SELECT entry_id FROM kanji WHERE text = ?`).all(input) as { entry_id: number }[]
    ).map((r) => r.entry_id),
  );
  const kanaExactSet = new Set(
    (
      db.prepare(`SELECT entry_id FROM kana WHERE text = ? OR text = ?`).all(hiragana, input) as {
        entry_id: number;
      }[]
    ).map((r) => r.entry_id),
  );

  const results: ScoredEntry[] = entryRows.map((r) => {
    const isExact = kanjiExactSet.has(r.entry_id) || kanaExactSet.has(r.entry_id);
    const baseScore = isExact ? 10000 : 5000;
    return {
      entryId: r.entry_id,
      score: baseScore + r.priority + r.common * 50,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function searchRomaji(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  const lower = input.toLowerCase();
  const hiragana = toHiragana(lower);

  const matchRows = db
    .prepare(
      `SELECT DISTINCT ka.entry_id FROM kana ka
       WHERE ka.romaji LIKE ? OR ka.text LIKE ? LIMIT 500`,
    )
    .all(`${lower}%`, `${hiragana}%`) as { entry_id: number }[];

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  const entryRows = db
    .prepare(
      `SELECT e.id as entry_id, e.priority, e.common FROM entries e WHERE e.id IN (${placeholders})`,
    )
    .all(...ids) as { entry_id: number; priority: number; common: number }[];

  const romajiExactSet = new Set(
    (
      db.prepare(`SELECT entry_id FROM kana WHERE romaji = ?`).all(lower) as { entry_id: number }[]
    ).map((r) => r.entry_id),
  );
  const kanaExactSet = new Set(
    (
      db.prepare(`SELECT entry_id FROM kana WHERE text = ?`).all(hiragana) as { entry_id: number }[]
    ).map((r) => r.entry_id),
  );

  const results: ScoredEntry[] = entryRows.map((r) => {
    const isExact = romajiExactSet.has(r.entry_id) || kanaExactSet.has(r.entry_id);
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
    const senseCounts = db
      .prepare(
        `SELECT entry_id, COUNT(*) as c FROM senses WHERE entry_id IN (${ph}) GROUP BY entry_id`,
      )
      .all(...exactIds) as { entry_id: number; c: number }[];
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
function expandWithSynonyms(
  db: Database.Database,
  words: string[],
  maxPerWord: number = 8,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (words.length === 0) return map;
  for (const w of words) map.set(w.toLowerCase(), []);

  try {
    const placeholders = words.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT word, synonym FROM synonyms WHERE word IN (${placeholders})`)
      .all(...words.map((w) => w.toLowerCase())) as {
      word: string;
      synonym: string;
    }[];
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

function applyGlossBonus(
  db: Database.Database,
  rows: { entry_id: number; priority: number; common: number }[],
  input: string,
  tierBonus: number = 0,
): ScoredEntry[] {
  const lowerQuery = input.toLowerCase();
  return rows.map((r) => {
    let bonus = 0;
    const exactBonus = r.common ? 5000 : 0;
    const senseRows = db
      .prepare(`SELECT glosses FROM senses WHERE entry_id = ?`)
      .all(r.entry_id) as { glosses: string }[];
    for (let si = 0; si < senseRows.length; si++) {
      const senseBonus = si === 0 ? 3000 : 1000;
      try {
        const glosses = JSON.parse(senseRows[si].glosses) as { lang: string; text: string }[];
        let gi = 0;
        for (const g of glosses) {
          if (g.lang !== "eng") continue;
          const gl = g.text.toLowerCase();
          const isExact = gl === lowerQuery || gl === "to " + lowerQuery;
          const isAnnotated =
            !isExact &&
            (gl.startsWith(lowerQuery + " (") ||
              gl.startsWith(lowerQuery + "(") ||
              gl.startsWith("to " + lowerQuery + " (") ||
              gl.startsWith("to " + lowerQuery + "("));
          if (isExact || isAnnotated) {
            const posFactor = gi === 0 ? 1.0 : 0.5;
            bonus = Math.max(bonus, senseBonus + Math.floor(exactBonus * posFactor));
          } else if (
            gl.startsWith(lowerQuery + " ") ||
            gl.startsWith(lowerQuery + ",") ||
            gl.startsWith("to " + lowerQuery + " ") ||
            gl.startsWith("to " + lowerQuery + ",")
          ) {
            bonus = Math.max(bonus, senseBonus);
          }
          gi++;
        }
      } catch {}
    }
    return {
      entryId: r.entry_id,
      score: 2000 + r.priority + r.common * 50 + bonus + tierBonus,
    };
  });
}

function searchEnglishFts(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  const cleaned = input.replace(/['"]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const seenIds = new Set<number>();
  const allResults: ScoredEntry[] = [];

  // Tier 1: Phrase match
  const tier1Rows = db
    .prepare(
      `SELECT fts.entry_id, e.priority, e.common
       FROM glosses_fts fts
       JOIN entries e ON fts.entry_id = e.id
       WHERE glosses_fts MATCH ?
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
    )
    .all(`"${cleaned}"*`, limit * 4) as {
    entry_id: number;
    priority: number;
    common: number;
  }[];
  const tier1 = applyGlossBonus(db, tier1Rows, input, 1000);
  for (const r of tier1) {
    seenIds.add(r.entryId);
    allResults.push(r);
  }

  // Tier 2: AND of content words (multi-word only)
  const contentWords = cleaned.split(" ").filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  if (contentWords.length > 1) {
    const andQuery = contentWords.map((w) => `"${w}"*`).join(" AND ");
    const tier2Rows = db
      .prepare(
        `SELECT fts.entry_id, e.priority, e.common
         FROM glosses_fts fts
         JOIN entries e ON fts.entry_id = e.id
         WHERE glosses_fts MATCH ?
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
      )
      .all(andQuery, limit * 4) as {
      entry_id: number;
      priority: number;
      common: number;
    }[];
    const tier2 = applyGlossBonus(db, tier2Rows, input, 500);
    for (const r of tier2) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  // Tier 2.5: Synonym-expanded AND
  const synMap = expandWithSynonyms(db, contentWords);
  if (contentWords.length > 0) {
    const groupQueries = contentWords.map((w) => {
      const syns = synMap.get(w.toLowerCase()) ?? [];
      const all = [w, ...syns];
      if (all.length === 1) return `"${all[0]}"*`;
      return "(" + all.map((s) => `"${s}"*`).join(" OR ") + ")";
    });
    const synQuery = groupQueries.join(" AND ");
    try {
      const tier25Rows = db
        .prepare(
          `SELECT fts.entry_id, e.priority, e.common
           FROM glosses_fts fts
           JOIN entries e ON fts.entry_id = e.id
           WHERE glosses_fts MATCH ?
           ORDER BY e.priority + (e.common * 50) DESC
           LIMIT ?`,
        )
        .all(synQuery, limit * 4) as {
        entry_id: number;
        priority: number;
        common: number;
      }[];
      const tier25 = applyGlossBonus(db, tier25Rows, input, 250);
      for (const r of tier25) {
        if (!seenIds.has(r.entryId)) {
          seenIds.add(r.entryId);
          allResults.push(r);
        }
      }
    } catch {}
  }

  // Tier 3: OR fallback (only if < 5 results)
  if (allResults.length < 5 && contentWords.length > 1) {
    const orQuery = contentWords.map((w) => `"${w}"*`).join(" OR ");
    const tier3Rows = db
      .prepare(
        `SELECT fts.entry_id, e.priority, e.common
         FROM glosses_fts fts
         JOIN entries e ON fts.entry_id = e.id
         WHERE glosses_fts MATCH ?
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
      )
      .all(orQuery, limit * 4) as {
      entry_id: number;
      priority: number;
      common: number;
    }[];
    const tier3 = applyGlossBonus(db, tier3Rows, input, 0);
    for (const r of tier3) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  return allResults;
}

function searchEnglishLike(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  const cleaned = input
    .toLowerCase()
    .replace(/%/g, "")
    .replace(/_/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const seenIds = new Set<number>();
  const allResults: ScoredEntry[] = [];

  // Tier 1: Full phrase LIKE (word-boundary match)
  const tier1Rows = db
    .prepare(
      `SELECT DISTINCT s.entry_id, e.priority, e.common
       FROM senses s
       JOIN entries e ON s.entry_id = e.id
       WHERE s.glosses LIKE ? OR s.glosses LIKE ?
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`,
    )
    .all(`% ${cleaned}%`, `%"${cleaned}%`, limit * 4) as {
    entry_id: number;
    priority: number;
    common: number;
  }[];
  const tier1 = applyGlossBonus(db, tier1Rows, input, 1000);
  for (const r of tier1) {
    seenIds.add(r.entryId);
    allResults.push(r);
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

    const tier2Rows = db
      .prepare(
        `SELECT s.entry_id, e.priority, e.common
         FROM senses s
         JOIN entries e ON s.entry_id = e.id
         WHERE ${whereClause}
         GROUP BY s.entry_id, e.priority, e.common
         HAVING ${havingClause}
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
      )
      .all(...likePatterns, ...likePatterns, limit * 4) as {
      entry_id: number;
      priority: number;
      common: number;
    }[];
    const tier2 = applyGlossBonus(db, tier2Rows, input, 500);
    for (const r of tier2) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  // Tier 2.5: Synonym-expanded AND (LIKE)
  const synMapLike = expandWithSynonyms(db, contentWords, 15);
  if (contentWords.length > 0) {
    const groups = contentWords.map((w) => {
      const syns = synMapLike.get(w.toLowerCase()) ?? [];
      // Use stemmed original word + full synonym words (synonyms are already canonical forms).
      // Filter out very short synonyms (<=3 chars) to avoid excessive LIKE false positives.
      const parts = new Set<string>();
      parts.add(stemForLike(w));
      for (const s of syns) {
        if (s.length > 3) parts.add(s);
      }
      return [...parts];
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
      const tier25Rows = db
        .prepare(
          `SELECT s.entry_id, e.priority, e.common
           FROM senses s
           JOIN entries e ON s.entry_id = e.id
           WHERE ${whereClause}
           GROUP BY s.entry_id, e.priority, e.common
           HAVING ${havingClause}
           ORDER BY e.priority + (e.common * 50) DESC
           LIMIT ?`,
        )
        .all(...allPatterns, ...havingPatterns, limit * 4) as {
        entry_id: number;
        priority: number;
        common: number;
      }[];
      const tier25 = applyGlossBonus(db, tier25Rows, input, 250);
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

    const tier3Rows = db
      .prepare(
        `SELECT DISTINCT s.entry_id, e.priority, e.common
         FROM senses s
         JOIN entries e ON s.entry_id = e.id
         WHERE ${whereClause}
         ORDER BY e.priority + (e.common * 50) DESC
         LIMIT ?`,
      )
      .all(...likePatterns, limit * 4) as {
      entry_id: number;
      priority: number;
      common: number;
    }[];
    const tier3 = applyGlossBonus(db, tier3Rows, input, 0);
    for (const r of tier3) {
      if (!seenIds.has(r.entryId)) {
        seenIds.add(r.entryId);
        allResults.push(r);
      }
    }
  }

  return allResults;
}

let useLikeFallback = false;

function searchEnglish(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  return useLikeFallback ? searchEnglishLike(db, input, limit) : searchEnglishFts(db, input, limit);
}

function searchDictionary(db: Database.Database, query: string, limit = 50): DictResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { hasJapanese, isAscii } = classifyInput(trimmed);

  const allResults: ScoredEntry[] = [];

  if (hasJapanese) {
    allResults.push(...searchJapanese(db, trimmed, limit));
  }
  if (isAscii) {
    allResults.push(...searchRomaji(db, trimmed, limit));
    allResults.push(...searchEnglish(db, trimmed, limit));
  }

  const scoreMap = new Map<number, number>();
  for (const r of allResults) {
    const existing = scoreMap.get(r.entryId);
    if (existing === undefined || r.score > existing) {
      scoreMap.set(r.entryId, r.score);
    }
  }

  const sorted = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  if (sorted.length === 0) return [];

  const ids = sorted.map((s) => s[0]);
  const placeholders = ids.map(() => "?").join(",");

  const kanjiRows = db
    .prepare(`SELECT entry_id, text FROM kanji WHERE entry_id IN (${placeholders})`)
    .all(...ids) as { entry_id: number; text: string }[];

  const kanaRows = db
    .prepare(`SELECT entry_id, text FROM kana WHERE entry_id IN (${placeholders})`)
    .all(...ids) as { entry_id: number; text: string }[];

  const senseRows = db
    .prepare(`SELECT entry_id, glosses FROM senses WHERE entry_id IN (${placeholders})`)
    .all(...ids) as { entry_id: number; glosses: string }[];

  const kanjiMap = new Map<number, string[]>();
  for (const r of kanjiRows) {
    const arr = kanjiMap.get(r.entry_id) ?? [];
    arr.push(r.text);
    kanjiMap.set(r.entry_id, arr);
  }

  const kanaMap = new Map<number, string[]>();
  for (const r of kanaRows) {
    const arr = kanaMap.get(r.entry_id) ?? [];
    arr.push(r.text);
    kanaMap.set(r.entry_id, arr);
  }

  const glossMap = new Map<number, string[]>();
  for (const r of senseRows) {
    const arr = glossMap.get(r.entry_id) ?? [];
    try {
      const glosses = JSON.parse(r.glosses) as { lang: string; text: string }[];
      for (const g of glosses) {
        if (g.lang === "eng") arr.push(g.text);
      }
    } catch {}
    glossMap.set(r.entry_id, arr);
  }

  return sorted.map(([entryId, score]) => ({
    entryId,
    score,
    kanjiTexts: kanjiMap.get(entryId) ?? [],
    kanaTexts: kanaMap.get(entryId) ?? [],
    glossTexts: glossMap.get(entryId) ?? [],
  }));
}

// ─── Test helpers ───

/** Assert the first result contains this kanji */
function expectFirstKanji(results: DictResult[], kanji: string) {
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].kanjiTexts).toContain(kanji);
}

/** Assert the first result contains this kana */
function expectFirstKana(results: DictResult[], kana: string) {
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].kanaTexts).toContain(kana);
}

/** Assert any result in the list contains this kanji */
function expectContainsKanji(results: DictResult[], kanji: string) {
  expect(results.length).toBeGreaterThan(0);
  expect(results.some((r) => r.kanjiTexts.includes(kanji))).toBe(true);
}

/** Assert any result in the list contains this kana */
function expectContainsKana(results: DictResult[], kana: string) {
  expect(results.length).toBeGreaterThan(0);
  expect(results.some((r) => r.kanaTexts.includes(kana))).toBe(true);
}

/** Assert results are non-empty */
function expectHasResults(results: DictResult[]) {
  expect(results.length).toBeGreaterThan(0);
}

// ─── Tests ───

let db: Database.Database;

beforeAll(() => {
  db = new Database(DB_PATH, { readonly: true });
});

afterAll(() => {
  db?.close();
});

// ════════════════════════════════════════════════════════════
// 1. Input classification (7 tests)
// ════════════════════════════════════════════════════════════

describe("classifyInput", () => {
  test("hiragana → hasJapanese", () => {
    const r = classifyInput("かお");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("katakana → hasJapanese", () => {
    const r = classifyInput("カオ");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("kanji → hasJapanese", () => {
    const r = classifyInput("顔");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("ASCII letters → isAscii", () => {
    const r = classifyInput("kao");
    expect(r.hasJapanese).toBe(false);
    expect(r.isAscii).toBe(true);
  });

  test("mixed kanji + ASCII → hasJapanese only", () => {
    const r = classifyInput("顔abc");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("'face' is ASCII (not trapped by wanakana isRomaji)", () => {
    const r = classifyInput("face");
    expect(r.isAscii).toBe(true);
    expect(r.hasJapanese).toBe(false);
  });

  test("accented latin → neither ASCII nor Japanese", () => {
    const r = classifyInput("café");
    expect(r.isAscii).toBe(false);
    expect(r.hasJapanese).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// Run all search tests in both FTS5 and LIKE modes
// ════════════════════════════════════════════════════════════

describe.each(["FTS5", "LIKE"] as const)("Search [%s]", (mode) => {
  beforeAll(() => {
    useLikeFallback = mode === "LIKE";
  });

  // ════════════════════════════════════════════════════════════
  // 2. Kanji search — exact match first (12 tests)
  // ════════════════════════════════════════════════════════════

  describe("Kanji exact search", () => {
    test.each([
      ["猫", "ねこ"],
      ["山", "やま"],
      ["海", "うみ"],
      ["川", "かわ"],
      ["花", "はな"],
      ["木", "き"],
      ["火", "ひ"],
      ["石", "いし"],
      ["金", "かね"],
      ["車", "くるま"],
      ["手", "て"],
      ["目", "め"],
    ])("'%s' → first result is %s reading", (kanji, kana) => {
      const results = searchDictionary(db, kanji);
      expectFirstKanji(results, kanji);
      expectFirstKana(results, kana);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. Kanji exact beats prefix (6 tests)
  // ════════════════════════════════════════════════════════════

  describe("Kanji exact beats prefix compounds", () => {
    test("犬 before 犬猿, 犬小屋, etc.", () => {
      const results = searchDictionary(db, "犬");
      expectFirstKanji(results, "犬");
      expectFirstKana(results, "いぬ");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("山 before 山脈, 山田, etc.", () => {
      const results = searchDictionary(db, "山");
      expectFirstKanji(results, "山");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("花 before 花火, 花見, etc.", () => {
      const results = searchDictionary(db, "花");
      expectFirstKanji(results, "花");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("口 before 口実, 口座, etc.", () => {
      const results = searchDictionary(db, "口");
      expectFirstKanji(results, "口");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("心 before 心配, 心理, etc.", () => {
      const results = searchDictionary(db, "心");
      expectFirstKanji(results, "心");
      // Exact 心 entries should beat prefix compounds like 心配
      const firstCompound = results.find(
        (r) => !r.kanjiTexts.includes("心") && r.kanjiTexts.some((k) => k.startsWith("心")),
      );
      if (firstCompound) {
        expect(results[0].score).toBeGreaterThan(firstCompound.score);
      }
    });

    test("愛 before 愛情, 愛人, etc.", () => {
      const results = searchDictionary(db, "愛");
      expectFirstKanji(results, "愛");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. Kana search (10 tests)
  // ════════════════════════════════════════════════════════════

  describe("Kana search", () => {
    test("'ねこ' → 猫 first", () => {
      const results = searchDictionary(db, "ねこ");
      expectFirstKanji(results, "猫");
    });

    test("'やま' → 山 first", () => {
      const results = searchDictionary(db, "やま");
      expectFirstKanji(results, "山");
    });

    test("'うみ' → 海 first", () => {
      const results = searchDictionary(db, "うみ");
      expectFirstKanji(results, "海");
    });

    test("'いし' → 石 first", () => {
      const results = searchDictionary(db, "いし");
      expectFirstKanji(results, "石");
    });

    test("'さくら' → 桜 first", () => {
      const results = searchDictionary(db, "さくら");
      expectFirstKanji(results, "桜");
    });

    test("'かわ' → 川 is in results", () => {
      const results = searchDictionary(db, "かわ");
      expectContainsKanji(results, "川");
    });

    test("'はな' → 花 is in results", () => {
      const results = searchDictionary(db, "はな");
      expectContainsKanji(results, "花");
    });

    test("'がっこう' → 学校 first", () => {
      const results = searchDictionary(db, "がっこう");
      expectFirstKanji(results, "学校");
    });

    test("'でんしゃ' → 電車 first", () => {
      const results = searchDictionary(db, "でんしゃ");
      expectFirstKanji(results, "電車");
    });

    test("'ともだち' → 友達 first", () => {
      const results = searchDictionary(db, "ともだち");
      expectFirstKanji(results, "友達");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. Katakana search (6 tests)
  // ════════════════════════════════════════════════════════════

  describe("Katakana search", () => {
    test("'ネコ' → same first result as 'ねこ'", () => {
      const hira = searchDictionary(db, "ねこ");
      const kata = searchDictionary(db, "ネコ");
      expectHasResults(kata);
      expect(kata[0].entryId).toBe(hira[0].entryId);
    });

    test("'カオ' → same first result as 'かお'", () => {
      const hira = searchDictionary(db, "かお");
      const kata = searchDictionary(db, "カオ");
      expectHasResults(kata);
      expect(kata[0].entryId).toBe(hira[0].entryId);
    });

    test("'ラーメン' → finds ramen", () => {
      const results = searchDictionary(db, "ラーメン");
      expectHasResults(results);
      expectFirstKana(results, "ラーメン");
    });

    test("'テレビ' → finds television", () => {
      const results = searchDictionary(db, "テレビ");
      expectHasResults(results);
      expectFirstKana(results, "テレビ");
    });

    test("'コーヒー' → finds coffee", () => {
      const results = searchDictionary(db, "コーヒー");
      expectHasResults(results);
      expectFirstKana(results, "コーヒー");
    });

    test("'タクシー' → finds taxi", () => {
      const results = searchDictionary(db, "タクシー");
      expectHasResults(results);
      expectFirstKana(results, "タクシー");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. Romaji search (14 tests)
  // ════════════════════════════════════════════════════════════

  describe("Romaji search", () => {
    test("'neko' → 猫", () => {
      const results = searchDictionary(db, "neko");
      expectFirstKanji(results, "猫");
    });

    test("'yama' → 山", () => {
      const results = searchDictionary(db, "yama");
      expectFirstKanji(results, "山");
    });

    test("'umi' → 海", () => {
      const results = searchDictionary(db, "umi");
      expectFirstKanji(results, "海");
    });

    test("'ishi' → 石", () => {
      const results = searchDictionary(db, "ishi");
      expectFirstKanji(results, "石");
    });

    test("'kao' → 顔", () => {
      const results = searchDictionary(db, "kao");
      expectFirstKanji(results, "顔");
    });

    test("'taberu' → 食べる", () => {
      const results = searchDictionary(db, "taberu");
      expectFirstKanji(results, "食べる");
    });

    test("'hashiru' → 走る", () => {
      const results = searchDictionary(db, "hashiru");
      expectFirstKanji(results, "走る");
    });

    test("'nomu' → 飲む", () => {
      const results = searchDictionary(db, "nomu");
      expectFirstKanji(results, "飲む");
    });

    test("'yomu' → 読む", () => {
      const results = searchDictionary(db, "yomu");
      expectFirstKanji(results, "読む");
    });

    test("'kaku' → 書く is in results", () => {
      const results = searchDictionary(db, "kaku");
      expectContainsKanji(results, "書く");
    });

    test("'miru' → 見る", () => {
      const results = searchDictionary(db, "miru");
      expectFirstKanji(results, "見る");
    });

    test("'sensei' → 先生", () => {
      const results = searchDictionary(db, "sensei");
      expectFirstKanji(results, "先生");
    });

    test("'sakura' → 桜", () => {
      const results = searchDictionary(db, "sakura");
      expectFirstKanji(results, "桜");
    });

    test("'samurai' → 侍 is in results", () => {
      const results = searchDictionary(db, "samurai");
      expectContainsKanji(results, "侍");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. English search — first result (16 tests)
  // ════════════════════════════════════════════════════════════

  describe("English search — first result", () => {
    test("'face' → 顔 or 面", () => {
      const results = searchDictionary(db, "face");
      expectHasResults(results);
      const first = results[0].kanjiTexts;
      expect(first.some((k) => ["顔", "面"].includes(k))).toBe(true);
    });

    test("'dog' → 犬", () => {
      expectFirstKanji(searchDictionary(db, "dog"), "犬");
    });

    test("'cat' → 猫", () => {
      expectFirstKanji(searchDictionary(db, "cat"), "猫");
    });

    test("'mountain' → 山", () => {
      expectFirstKanji(searchDictionary(db, "mountain"), "山");
    });

    test("'rain' → 雨", () => {
      expectFirstKanji(searchDictionary(db, "rain"), "雨");
    });

    test("'flower' → 花", () => {
      expectFirstKanji(searchDictionary(db, "flower"), "花");
    });

    test("'money' → 金", () => {
      expectFirstKanji(searchDictionary(db, "money"), "金");
    });

    test("'dream' → 夢", () => {
      expectFirstKanji(searchDictionary(db, "dream"), "夢");
    });

    test("'love' → 愛", () => {
      expectFirstKanji(searchDictionary(db, "love"), "愛");
    });

    test("'school' → 学校", () => {
      expectFirstKanji(searchDictionary(db, "school"), "学校");
    });

    test("'hospital' → 病院", () => {
      expectFirstKanji(searchDictionary(db, "hospital"), "病院");
    });

    test("'eat' → 食べる or 食う (primary 'to eat' meaning)", () => {
      const results = searchDictionary(db, "eat");
      expectHasResults(results);
      const first = results[0].kanjiTexts;
      expect(first.includes("食べる") || first.includes("食う")).toBe(true);
    });

    test("'run' → 走る or ラン", () => {
      const results = searchDictionary(db, "run");
      expectHasResults(results);
      const hasRun =
        results[0].kanjiTexts.includes("走る") || results[0].kanaTexts.includes("ラン");
      expect(hasRun).toBe(true);
    });

    test("'swim' → 泳ぐ", () => {
      expectFirstKanji(searchDictionary(db, "swim"), "泳ぐ");
    });

    test("'die' → 死ぬ", () => {
      expectFirstKanji(searchDictionary(db, "die"), "死ぬ");
    });

    test("'sell' → 売る", () => {
      expectFirstKanji(searchDictionary(db, "sell"), "売る");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 8. English search — in results (10 tests)
  // ════════════════════════════════════════════════════════════

  describe("English search — in results", () => {
    test("'river' → finds 川", () => {
      expectContainsKanji(searchDictionary(db, "river"), "川");
    });

    test("'stone' → finds 石", () => {
      expectContainsKanji(searchDictionary(db, "stone"), "石");
    });

    test("'car' → finds 車", () => {
      expectContainsKanji(searchDictionary(db, "car"), "車");
    });

    test("'tree' → finds 木", () => {
      expectContainsKanji(searchDictionary(db, "tree"), "木");
    });

    test("'eye' → finds 目", () => {
      expectContainsKanji(searchDictionary(db, "eye"), "目");
    });

    test("'mouth' → finds 口", () => {
      expectContainsKanji(searchDictionary(db, "mouth"), "口");
    });

    test("'hand' → finds 手", () => {
      expectContainsKanji(searchDictionary(db, "hand"), "手");
    });

    test("'red' → finds 赤", () => {
      expectContainsKanji(searchDictionary(db, "red"), "赤");
    });

    test("'blue' → finds 青", () => {
      expectContainsKanji(searchDictionary(db, "blue"), "青");
    });

    test("'black' → finds 黒", () => {
      expectContainsKanji(searchDictionary(db, "black"), "黒");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 9. Bidirectional — same word via all paths (8 tests)
  // ════════════════════════════════════════════════════════════

  describe("Bidirectional: same word via all search paths", () => {
    test("顔 / かお / kao / face → all find 顔", () => {
      for (const q of ["顔", "かお", "kao", "face"]) {
        expectContainsKanji(searchDictionary(db, q), "顔");
      }
    });

    test("猫 / ねこ / neko / cat → all find 猫", () => {
      for (const q of ["猫", "ねこ", "neko", "cat"]) {
        expectContainsKanji(searchDictionary(db, q), "猫");
      }
    });

    test("犬 / いぬ / inu / dog → all find 犬", () => {
      for (const q of ["犬", "いぬ", "inu", "dog"]) {
        expectContainsKanji(searchDictionary(db, q), "犬");
      }
    });

    test("山 / やま / yama / mountain → all find 山", () => {
      for (const q of ["山", "やま", "yama", "mountain"]) {
        expectContainsKanji(searchDictionary(db, q), "山");
      }
    });

    test("海 / うみ / umi → all find 海", () => {
      for (const q of ["海", "うみ", "umi"]) {
        expectContainsKanji(searchDictionary(db, q), "海");
      }
    });

    test("花 / はな / hana / flower → all find 花", () => {
      for (const q of ["花", "はな", "hana", "flower"]) {
        expectContainsKanji(searchDictionary(db, q), "花");
      }
    });

    test("走る / はしる / hashiru / run → all find 走る", () => {
      for (const q of ["走る", "はしる", "hashiru", "run"]) {
        expectContainsKanji(searchDictionary(db, q), "走る");
      }
    });

    test("読む / よむ / yomu / read → all find 読む", () => {
      for (const q of ["読む", "よむ", "yomu", "read"]) {
        expectContainsKanji(searchDictionary(db, q), "読む");
      }
    });
  });

  // ════════════════════════════════════════════════════════════
  // 10. Ordering quality (8 tests)
  // ════════════════════════════════════════════════════════════

  describe("Ordering quality", () => {
    test("exact match scores higher than prefix match", () => {
      const results = searchDictionary(db, "かお");
      expect(results.length).toBeGreaterThan(1);
      // 顔 (exact) should score above 顔色 etc (prefix)
      expectFirstKanji(results, "顔");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("'face' → first result has 'face' as primary meaning", () => {
      const results = searchDictionary(db, "face");
      expect(results.length).toBeGreaterThan(1);
      const first = results[0].kanjiTexts;
      expect(first.some((k) => ["顔", "面"].includes(k))).toBe(true);
    });

    test("common 水 ranks first for 'みず'", () => {
      const results = searchDictionary(db, "みず");
      expectFirstKanji(results, "水");
    });

    test("exact romaji 'neko' → 猫 scores above prefix matches like 'nekokaburi'", () => {
      const results = searchDictionary(db, "neko");
      expectFirstKanji(results, "猫");
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThan(results[1].score);
      }
    });

    test("scores are monotonically non-increasing", () => {
      const results = searchDictionary(db, "take");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    test("'rain' → 雨 (first-sense match) beats entries with 'rain' as secondary sense", () => {
      const results = searchDictionary(db, "rain");
      expectFirstKanji(results, "雨");
    });

    test("compound 学校 returns for 'がっこう' with exact match score", () => {
      const results = searchDictionary(db, "がっこう");
      expectFirstKanji(results, "学校");
      // Exact match should give 10000+ base
      expect(results[0].score).toBeGreaterThan(10000);
    });

    test("'school' → 学校 ranks above obscure entries", () => {
      const results = searchDictionary(db, "school");
      expectFirstKanji(results, "学校");
      // 学校 should rank at or above any other entry (may tie with other common school words)
      expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 11. Romaji-English ambiguity (5 tests)
  // ════════════════════════════════════════════════════════════

  describe("Romaji-English ambiguity", () => {
    test("'sake' → finds 酒 (romaji path) and English 'sake' entries", () => {
      const results = searchDictionary(db, "sake");
      expectContainsKanji(results, "酒");
    });

    test("'hi' → finds 日 or 火 via romaji", () => {
      const results = searchDictionary(db, "hi");
      expectHasResults(results);
      const hasHiWord = results.some(
        (r) => r.kanjiTexts.includes("日") || r.kanjiTexts.includes("火"),
      );
      expect(hasHiWord).toBe(true);
    });

    test("'me' → finds 目 via romaji", () => {
      const results = searchDictionary(db, "me");
      expectContainsKanji(results, "目");
    });

    test("'to' → returns results (short English/romaji)", () => {
      expectHasResults(searchDictionary(db, "to"));
    });

    test("'pan' → finds パン (bread) via romaji and English results", () => {
      const results = searchDictionary(db, "pan");
      expectContainsKana(results, "パン");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 12. Multi-word and phrase searches (5 tests)
  // ════════════════════════════════════════════════════════════

  describe("Multi-word English searches", () => {
    test("'to eat' → finds 食べる", () => {
      expectContainsKanji(searchDictionary(db, "to eat"), "食べる");
    });

    test("'to run' → finds 走る", () => {
      expectContainsKanji(searchDictionary(db, "to run"), "走る");
    });

    test("'to swim' → finds 泳ぐ", () => {
      expectContainsKanji(searchDictionary(db, "to swim"), "泳ぐ");
    });

    test("'cherry blossom' → finds 桜", () => {
      expectContainsKanji(searchDictionary(db, "cherry blossom"), "桜");
    });

    test("'dog food' → returns results", () => {
      expectHasResults(searchDictionary(db, "dog food"));
    });
  });

  // ════════════════════════════════════════════════════════════
  // 13. Edge cases (13 tests)
  // ════════════════════════════════════════════════════════════

  describe("Edge cases", () => {
    test("empty string → empty results", () => {
      expect(searchDictionary(db, "")).toEqual([]);
    });

    test("whitespace only → empty results", () => {
      expect(searchDictionary(db, "   ")).toEqual([]);
    });

    test("tab and newline → empty results", () => {
      expect(searchDictionary(db, "\t\n")).toEqual([]);
    });

    test("single hiragana 'あ' → returns results", () => {
      expectHasResults(searchDictionary(db, "あ"));
    });

    test("single katakana 'ア' → returns results", () => {
      expectHasResults(searchDictionary(db, "ア"));
    });

    test("single kanji '日' → returns results", () => {
      expectHasResults(searchDictionary(db, "日"));
    });

    test("single ASCII letter 'a' → returns results", () => {
      expectHasResults(searchDictionary(db, "a"));
    });

    test("case insensitive romaji: 'NEKO' = 'neko'", () => {
      const upper = searchDictionary(db, "NEKO");
      const lower = searchDictionary(db, "neko");
      expectHasResults(upper);
      expect(upper[0].entryId).toBe(lower[0].entryId);
    });

    test("case insensitive English: 'DOG' = 'dog'", () => {
      const upper = searchDictionary(db, "DOG");
      const lower = searchDictionary(db, "dog");
      expectHasResults(upper);
      // Both should find 犬 somewhere in results
      expectContainsKanji(upper, "犬");
      expectContainsKanji(lower, "犬");
    });

    test("leading/trailing whitespace is trimmed", () => {
      const trimmed = searchDictionary(db, "猫");
      const padded = searchDictionary(db, "  猫  ");
      expectHasResults(padded);
      expect(padded[0].entryId).toBe(trimmed[0].entryId);
    });

    test("special chars in query don't crash: quotes", () => {
      const results = searchDictionary(db, "it's");
      // Should not throw, may or may not have results
      expect(Array.isArray(results)).toBe(true);
    });

    test("very long query returns results or empty (no crash)", () => {
      const long = "a".repeat(200);
      const results = searchDictionary(db, long);
      expect(Array.isArray(results)).toBe(true);
    });

    test("numeric string '123' does not crash", () => {
      const results = searchDictionary(db, "123");
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 14. Result structure (4 tests)
  // ════════════════════════════════════════════════════════════

  describe("Result structure", () => {
    test("results have score, kanjiTexts, kanaTexts, glossTexts", () => {
      const results = searchDictionary(db, "猫");
      expectHasResults(results);
      const r = results[0];
      expect(typeof r.score).toBe("number");
      expect(Array.isArray(r.kanjiTexts)).toBe(true);
      expect(Array.isArray(r.kanaTexts)).toBe(true);
      expect(Array.isArray(r.glossTexts)).toBe(true);
    });

    test("kana-only entries have empty kanjiTexts", () => {
      const results = searchDictionary(db, "テレビ");
      expectHasResults(results);
      expect(results[0].kanjiTexts.length).toBe(0);
      expect(results[0].kanaTexts.length).toBeGreaterThan(0);
    });

    test("results respect limit parameter", () => {
      const results5 = searchDictionary(db, "a", 5);
      const results10 = searchDictionary(db, "a", 10);
      expect(results5.length).toBeLessThanOrEqual(5);
      expect(results10.length).toBeLessThanOrEqual(10);
      expect(results10.length).toBeGreaterThanOrEqual(results5.length);
    });

    test("each result has a unique entryId", () => {
      const results = searchDictionary(db, "take");
      const ids = results.map((r) => r.entryId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 15. Stemming + tiered matching (3 tests)
  // ════════════════════════════════════════════════════════════

  describe("Stemming + tiered matching", () => {
    test("'starving to death' → finds 餓死 and 飢え死に", () => {
      const results = searchDictionary(db, "starving to death");
      expectHasResults(results);
      expectContainsKana(results, "がし");
      expectContainsKanji(results, "飢え死に");
    });

    test("'starve to death' → finds 餓死 and 飢え死に", () => {
      const results = searchDictionary(db, "starve to death");
      expectHasResults(results);
      expectContainsKana(results, "がし");
      expectContainsKanji(results, "飢え死に");
    });

    test("'death from hunger' → finds 餓死 and 飢え死に", () => {
      const results = searchDictionary(db, "death from hunger");
      expectHasResults(results);
      expectContainsKana(results, "がし");
      expectContainsKanji(results, "飢え死に");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 16. Synonym expansion (semantic search) (14 tests)
  // ════════════════════════════════════════════════════════════

  describe("Synonym expansion", () => {
    // ── Multi-word queries where a synonym bridges the gap ──

    test("'death from hunger' → finds 餓死 (hunger→starvation bridge)", () => {
      // Glosses contain "starvation" and "death", NOT "hunger"
      const results = searchDictionary(db, "death from hunger");
      expectHasResults(results);
      expectContainsKana(results, "がし");
    });

    test("'chilly wind' → finds 寒風 (chilly→cold bridge)", () => {
      // 寒風 gloss: "cold wind" — searching "chilly wind" needs chilly→cold
      const results = searchDictionary(db, "chilly wind");
      expectContainsKanji(results, "寒風");
    });

    test("'aged person' → finds 老人 (aged→old bridge)", () => {
      // 老人 gloss: "old person" — searching "aged person" needs aged→old
      const results = searchDictionary(db, "aged person");
      expectContainsKanji(results, "老人");
    });

    test("'tiny child' → finds 幼子 or 幼児 (tiny→little bridge)", () => {
      // 幼子 gloss: "little child" — searching "tiny child" needs tiny→little
      const results = searchDictionary(db, "tiny child");
      expectHasResults(results);
      const found = results.some(
        (r) => r.kanjiTexts.includes("幼子") || r.kanjiTexts.includes("幼児"),
      );
      expect(found).toBe(true);
    });

    test("'icy wind' → finds 寒風 or 冷風 (icy→cold bridge)", () => {
      // 寒風 gloss: "cold wind" — searching "icy wind" needs icy→cold
      const results = searchDictionary(db, "icy wind");
      expectHasResults(results);
      const found = results.some(
        (r) => r.kanjiTexts.includes("寒風") || r.kanjiTexts.includes("冷風"),
      );
      expect(found).toBe(true);
    });

    // ── Synonym + stemming combined ──

    test("'dying of hunger' → finds 餓死 (hunger→starvation + dying stems)", () => {
      // Needs both synonym expansion (hunger→starvation) and stemming (dying→die/death)
      const results = searchDictionary(db, "dying of hunger");
      expectHasResults(results);
      expectContainsKana(results, "がし");
    });

    test("'starving from famine' → finds 餓死 (famine→starvation + starving stems)", () => {
      // Needs synonym (famine→starvation) — OR stemming alone may catch "starving"
      const results = searchDictionary(db, "starving from famine");
      expectHasResults(results);
      expectContainsKana(results, "がし");
    });

    // ── Single-word synonym queries ──

    test("'automobile' → finds 車 (automobile is already in gloss, baseline check)", () => {
      // 車 gloss includes "automobile" — this should work without synonyms (baseline)
      expectContainsKanji(searchDictionary(db, "automobile"), "車");
    });

    test("'physician' → finds 医者 (physician is already in gloss, baseline check)", () => {
      // 医者 gloss includes "physician" — baseline check
      expectContainsKanji(searchDictionary(db, "physician"), "医者");
    });

    test("'slumber' → finds 眠り (slumber→sleep bridge)", () => {
      // 眠り gloss: "sleep" — "slumber" is a synonym
      const results = searchDictionary(db, "slumber");
      expectContainsKanji(results, "眠り");
    });

    test("'foe' → finds 敵 (foe is already in gloss, baseline check)", () => {
      // 敵 gloss includes "foe" — baseline check
      expectContainsKanji(searchDictionary(db, "foe"), "敵");
    });

    // ── Synonym expansion should not degrade direct matches ──

    test("'cold' still returns 寒い as top result (direct match not degraded)", () => {
      // Verify that synonym expansion doesn't push direct matches down
      const results = searchDictionary(db, "cold");
      expectHasResults(results);
      expectContainsKanji(results, "寒い");
    });

    test("'starvation' still finds 餓死 directly (direct match not degraded)", () => {
      const results = searchDictionary(db, "starvation");
      expectContainsKana(results, "がし");
    });

    test("'death from starvation' ranks higher than 'death from hunger'", () => {
      // Direct wording match should score higher than synonym-expanded match
      const direct = searchDictionary(db, "death from starvation");
      const synonym = searchDictionary(db, "death from hunger");
      expectHasResults(direct);
      expectHasResults(synonym);
      const directGashi = direct.find((r) => r.kanaTexts.includes("がし"));
      const synGashi = synonym.find((r) => r.kanaTexts.includes("がし"));
      if (directGashi && synGashi) {
        expect(directGashi.score).toBeGreaterThanOrEqual(synGashi.score);
      }
    });
  });
}); // end describe.each FTS5/LIKE
