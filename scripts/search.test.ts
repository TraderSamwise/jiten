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
  // Step 1: find matching entry IDs via prefix match
  const matchRows = db
    .prepare(
      `SELECT DISTINCT entry_id FROM kanji WHERE text LIKE ?
       UNION
       SELECT DISTINCT entry_id FROM kana WHERE text LIKE ?`
    )
    .all(`${input}%`, `${hiragana}%`) as { entry_id: number }[];

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  // Step 2: fetch entry data and score in JS
  const entryRows = db
    .prepare(
      `SELECT e.id as entry_id, e.priority, e.common FROM entries e WHERE e.id IN (${placeholders})`
    )
    .all(...ids) as { entry_id: number; priority: number; common: number }[];

  // Check which entries have exact matches
  const kanjiExactSet = new Set(
    (db.prepare(`SELECT entry_id FROM kanji WHERE text = ?`).all(input) as { entry_id: number }[]).map(r => r.entry_id)
  );
  const kanaExactSet = new Set(
    (db.prepare(`SELECT entry_id FROM kana WHERE text = ?`).all(hiragana) as { entry_id: number }[]).map(r => r.entry_id)
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

  // Find matching entries via romaji or kana prefix
  const matchRows = db
    .prepare(
      `SELECT DISTINCT ka.entry_id FROM kana ka
       WHERE ka.romaji LIKE ? OR ka.text LIKE ?`
    )
    .all(`${lower}%`, `${hiragana}%`) as { entry_id: number }[];

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
  const placeholders = ids.map(() => "?").join(",");

  const entryRows = db
    .prepare(
      `SELECT e.id as entry_id, e.priority, e.common FROM entries e WHERE e.id IN (${placeholders})`
    )
    .all(...ids) as { entry_id: number; priority: number; common: number }[];

  // Check for exact romaji/kana matches
  const romajiExactSet = new Set(
    (db.prepare(`SELECT entry_id FROM kana WHERE romaji = ?`).all(lower) as { entry_id: number }[]).map(r => r.entry_id)
  );
  const kanaExactSet = new Set(
    (db.prepare(`SELECT entry_id FROM kana WHERE text = ?`).all(hiragana) as { entry_id: number }[]).map(r => r.entry_id)
  );

  const results: ScoredEntry[] = entryRows.map((r) => {
    const isExact = romajiExactSet.has(r.entry_id) || kanaExactSet.has(r.entry_id);
    const baseScore = isExact ? 9000 : 4000;
    return {
      entryId: r.entry_id,
      score: baseScore + r.priority + r.common * 50,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function searchEnglish(db: Database.Database, input: string, limit: number): ScoredEntry[] {
  const ftsQuery = input
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!ftsQuery) return [];

  const rows = db
    .prepare(
      `SELECT fts.entry_id, e.priority, e.common
       FROM glosses_fts fts
       JOIN entries e ON fts.entry_id = e.id
       WHERE glosses_fts MATCH ?
       ORDER BY e.priority + (e.common * 50) DESC
       LIMIT ?`
    )
    .all(`"${ftsQuery}"*`, limit) as {
    entry_id: number;
    priority: number;
    common: number;
  }[];

  // Compute gloss bonus for each result, weighted by sense position
  const lowerQuery = input.toLowerCase();
  return rows.map((r) => {
    let bonus = 0;
    const senseRows = db
      .prepare(`SELECT glosses FROM senses WHERE entry_id = ?`)
      .all(r.entry_id) as { glosses: string }[];
    for (let si = 0; si < senseRows.length; si++) {
      // First sense gets full bonus (3000), later senses get less (1000)
      const senseBonus = si === 0 ? 3000 : 1000;
      try {
        const glosses = JSON.parse(senseRows[si].glosses) as { lang: string; text: string }[];
        for (const g of glosses) {
          if (g.lang !== "eng") continue;
          const gl = g.text.toLowerCase();
          if (
            gl === lowerQuery ||
            gl.startsWith(lowerQuery + " ") ||
            gl.startsWith(lowerQuery + "(") ||
            gl.startsWith(lowerQuery + ",") ||
            gl === "to " + lowerQuery ||
            gl.startsWith("to " + lowerQuery + " ") ||
            gl.startsWith("to " + lowerQuery + "(")
          ) {
            bonus = Math.max(bonus, senseBonus);
          }
        }
      } catch {}
    }
    return {
      entryId: r.entry_id,
      score: 2000 + r.priority + r.common * 50 + bonus,
    };
  });
}

function searchDictionary(db: Database.Database, query: string, limit = 50): DictResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { hasJapanese, isAscii } = classifyInput(trimmed);

  // Collect scored entries from all applicable paths
  const allResults: ScoredEntry[] = [];

  if (hasJapanese) {
    allResults.push(...searchJapanese(db, trimmed, limit));
  }
  if (isAscii) {
    allResults.push(...searchRomaji(db, trimmed, limit));
    allResults.push(...searchEnglish(db, trimmed, limit));
  }

  // Deduplicate: keep max score per entry
  const scoreMap = new Map<number, number>();
  for (const r of allResults) {
    const existing = scoreMap.get(r.entryId);
    if (existing === undefined || r.score > existing) {
      scoreMap.set(r.entryId, r.score);
    }
  }

  // Sort by score DESC
  let sorted = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (sorted.length === 0) return [];

  // Fetch entry details
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

  // Build maps
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

  // Gloss bonus is now computed within searchEnglish() before merge,
  // so no post-assembly adjustment needed.

  return sorted.map(([entryId, score]) => ({
    entryId,
    score,
    kanjiTexts: kanjiMap.get(entryId) ?? [],
    kanaTexts: kanaMap.get(entryId) ?? [],
    glossTexts: glossMap.get(entryId) ?? [],
  }));
}

// ─── Tests ───

let db: Database.Database;

beforeAll(() => {
  db = new Database(DB_PATH, { readonly: true });
});

afterAll(() => {
  db?.close();
});

describe("classifyInput", () => {
  test("Japanese kana", () => {
    const r = classifyInput("かお");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("kanji", () => {
    const r = classifyInput("顔");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("ASCII/romaji", () => {
    const r = classifyInput("kao");
    expect(r.hasJapanese).toBe(false);
    expect(r.isAscii).toBe(true);
  });

  test("mixed script", () => {
    const r = classifyInput("顔abc");
    expect(r.hasJapanese).toBe(true);
    expect(r.isAscii).toBe(false);
  });

  test("'face' is ASCII, NOT romaji-only", () => {
    const r = classifyInput("face");
    expect(r.isAscii).toBe(true);
    // This is the key bug: wanakana's isRomaji("face") returns true,
    // so English never fired. Our classifier doesn't have that problem.
  });
});

describe("Bidirectional search", () => {
  test("'顔' → 顔 is first result", () => {
    const results = searchDictionary(db, "顔");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("顔");
  });

  test("'かお' → 顔 is first result", () => {
    const results = searchDictionary(db, "かお");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("顔");
  });

  test("'kao' → 顔 is first result", () => {
    const results = searchDictionary(db, "kao");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("顔");
  });

  test("'face' → 顔 is first result", () => {
    const results = searchDictionary(db, "face");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("顔");
  });
});

describe("Exact match priority", () => {
  test("'犬' → 犬 before compounds", () => {
    const results = searchDictionary(db, "犬");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("犬");
    // Verify it's the standalone entry, not a compound
    expect(results[0].kanaTexts).toContain("いぬ");
  });

  test("'taberu' → 食べる is first result", () => {
    const results = searchDictionary(db, "taberu");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("食べる");
  });

  test("'dog' → 犬 is first result", () => {
    const results = searchDictionary(db, "dog");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kanjiTexts).toContain("犬");
  });

  test("'eat' → 食べる or 食う is first result", () => {
    const results = searchDictionary(db, "eat");
    expect(results.length).toBeGreaterThan(0);
    // Both 食べる and 食う mean "to eat" as primary meaning;
    // either is acceptable as the first result
    const firstKanji = results[0].kanjiTexts;
    const isEatWord = firstKanji.includes("食べる") || firstKanji.includes("食う");
    expect(isEatWord).toBe(true);
  });
});

describe("Ordering quality", () => {
  test("'かお' → results ordered: 顔 first, then compounds by frequency", () => {
    const results = searchDictionary(db, "かお");
    expect(results.length).toBeGreaterThan(1);
    // 顔 should be first (exact match)
    expect(results[0].kanjiTexts).toContain("顔");
    // 顔 score should be higher than second result
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("'face' → common exact-gloss matches before obscure partial matches", () => {
    const results = searchDictionary(db, "face");
    expect(results.length).toBeGreaterThan(1);
    // First result should have "face" as an exact gloss
    expect(
      results[0].glossTexts.some((g) => g.toLowerCase() === "face")
    ).toBe(true);
  });

  test("common words rank above uncommon for same match type", () => {
    // Search for something with common and uncommon results
    const results = searchDictionary(db, "みず");
    expect(results.length).toBeGreaterThan(0);
    // 水 (みず) is very common and should be first
    expect(results[0].kanjiTexts).toContain("水");
  });
});

describe("Edge cases", () => {
  test("empty string → empty results", () => {
    const results = searchDictionary(db, "");
    expect(results).toEqual([]);
  });

  test("whitespace only → empty results", () => {
    const results = searchDictionary(db, "   ");
    expect(results).toEqual([]);
  });

  test("single kana character 'あ' → returns results", () => {
    const results = searchDictionary(db, "あ");
    expect(results.length).toBeGreaterThan(0);
  });

  test("katakana input 'カオ' → same first result as hiragana 'かお'", () => {
    const hiraganaResults = searchDictionary(db, "かお");
    const katakanaResults = searchDictionary(db, "カオ");
    expect(katakanaResults.length).toBeGreaterThan(0);
    expect(katakanaResults[0].entryId).toBe(hiraganaResults[0].entryId);
  });

  test("multi-word English 'to eat' → finds 食べる", () => {
    const results = searchDictionary(db, "to eat");
    expect(results.length).toBeGreaterThan(0);
    const hasTaberu = results.some((r) => r.kanjiTexts.includes("食べる"));
    expect(hasTaberu).toBe(true);
  });

  test("romaji that is also English 'sake' → finds 酒", () => {
    const results = searchDictionary(db, "sake");
    expect(results.length).toBeGreaterThan(0);
    // Should find 酒 (さけ) via romaji path
    const hasSake = results.some((r) => r.kanjiTexts.includes("酒"));
    expect(hasSake).toBe(true);
  });
});
