/**
 * Smart lookup integration tests against real dictionary.db
 *
 * These tests verify the full pipeline: text → substrings → deinflection →
 * dictionary search → ranked results. Uses better-sqlite3 to query the
 * actual dictionary database (same as scripts/search.test.ts).
 *
 * These simulate what happens when a user taps on text in the reader.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { toHiragana } from "wanakana";
import { deinflect, generateSubstrings, generateLookupCandidates } from "./deinflect";

const DB_PATH = path.resolve(__dirname, "..", "assets", "dictionary.db");

// ─── Minimal types mirroring production ───

interface DictResult {
  entryId: number;
  kanjiTexts: string[];
  kanaTexts: string[];
  glossTexts: string[];
}

interface LookupHit {
  matchedText: string;
  searchWord: string;
  reasons: string[];
  results: DictResult[];
}

// ─── Test harness: simplified search that mirrors production logic ───

let db: Database.Database;

beforeAll(() => {
  db = new Database(DB_PATH, { readonly: true });
});

afterAll(() => {
  db.close();
});

function searchJapaneseSimple(query: string, limit: number = 5): DictResult[] {
  const hiragana = toHiragana(query);

  // Prioritize exact matches over prefix matches (mirrors production ranking)
  const matchRows = db
    .prepare(
      `SELECT DISTINCT entry_id FROM (
         SELECT entry_id, 1 as pri FROM kanji WHERE text = ?
         UNION
         SELECT entry_id, 1 as pri FROM kana WHERE text = ? OR text = ?
         UNION
         SELECT entry_id, 2 as pri FROM kanji WHERE text LIKE ?
         UNION
         SELECT entry_id, 2 as pri FROM kana WHERE text LIKE ? OR text LIKE ?
       ) ORDER BY pri LIMIT ?`,
    )
    .all(query, query, hiragana, `${query}%`, `${query}%`, `${hiragana}%`, limit) as {
    entry_id: number;
  }[];

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.entry_id);
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

  return ids.map((id) => ({
    entryId: id,
    kanjiTexts: kanjiRows.filter((r) => r.entry_id === id).map((r) => r.text),
    kanaTexts: kanaRows.filter((r) => r.entry_id === id).map((r) => r.text),
    glossTexts: senseRows
      .filter((r) => r.entry_id === id)
      .flatMap((r) => {
        try {
          const glosses = JSON.parse(r.glosses) as { text: string }[];
          return glosses.map((g) => g.text);
        } catch {
          return [r.glosses];
        }
      }),
  }));
}

/**
 * Simulates the full smartLookup pipeline using better-sqlite3.
 * Returns all hits found for the given text.
 */
function simulateSmartLookup(text: string, maxLen: number = 15): LookupHit[] {
  const effectiveMaxLen = Math.min(text.length, maxLen);
  const substrings = generateSubstrings(text, effectiveMaxLen);
  const hits: LookupHit[] = [];
  const seenEntryIds = new Set<number>();

  for (const substr of substrings) {
    const candidates = deinflect(substr);

    for (const candidate of candidates) {
      const results = searchJapaneseSimple(candidate.word, 5);
      const newResults = results.filter((r) => !seenEntryIds.has(r.entryId));

      if (newResults.length > 0) {
        for (const r of newResults) seenEntryIds.add(r.entryId);
        hits.push({
          matchedText: substr,
          searchWord: candidate.word,
          reasons: candidate.reasons,
          results: newResults,
        });
      }
    }

    // Same early-stop logic as production
    const currentLen = substr.length;
    if (hits.length > 0 && currentLen < effectiveMaxLen - 2) break;
  }

  return hits;
}

// Helper: check if any hit contains a specific kanji or kana in its results
function hitsContainWord(hits: LookupHit[], word: string): boolean {
  return hits.some((h) =>
    h.results.some((r) => r.kanjiTexts.includes(word) || r.kanaTexts.includes(word)),
  );
}

function hitsContainGloss(hits: LookupHit[], substring: string): boolean {
  return hits.some((h) =>
    h.results.some((r) =>
      r.glossTexts.some((g) => g.toLowerCase().includes(substring.toLowerCase())),
    ),
  );
}

/**
 * Simulates smartLookupWithOffset using better-sqlite3.
 * Tries substrings containing the tap position, longest first,
 * preferring starts at/near the tap offset (same as production).
 */
function simulateSmartLookupWithOffset(
  text: string,
  tapOffset: number,
  maxLen: number = 15,
): LookupHit[] {
  for (let len = Math.min(text.length, maxLen); len >= 1; len--) {
    const minStart = Math.max(0, tapOffset - len + 1);
    const maxStart = Math.min(tapOffset, text.length - len);

    for (let start = Math.min(tapOffset, maxStart); start >= minStart; start--) {
      const substr = text.slice(start, start + len);
      const candidates = deinflect(substr);

      for (const candidate of candidates) {
        const results = searchJapaneseSimple(candidate.word, 5);
        if (results.length > 0) {
          return [
            {
              matchedText: substr,
              searchWord: candidate.word,
              reasons: candidate.reasons,
              results,
            },
          ];
        }
      }
    }
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════════
// 1. BASIC WORD LOOKUP — tapping on a dictionary-form word
// ═══════════════════════════════════════════════════════════════════

describe("Basic word lookup (dictionary form)", () => {
  test("猫 — finds 'cat'", () => {
    const hits = simulateSmartLookup("猫です");
    expect(hitsContainWord(hits, "猫")).toBe(true);
    expect(hitsContainGloss(hits, "cat")).toBe(true);
  });

  test("食べる — finds 'to eat'", () => {
    const hits = simulateSmartLookup("食べる");
    expect(hitsContainWord(hits, "食べる")).toBe(true);
    expect(hitsContainGloss(hits, "eat")).toBe(true);
  });

  test("運河 — finds 'canal'", () => {
    const hits = simulateSmartLookup("運河の近く");
    expect(hitsContainWord(hits, "運河")).toBe(true);
    expect(hitsContainGloss(hits, "canal")).toBe(true);
  });

  test("美しい — finds 'beautiful'", () => {
    const hits = simulateSmartLookup("美しい花");
    expect(hitsContainWord(hits, "美しい")).toBe(true);
    expect(hitsContainGloss(hits, "beautiful")).toBe(true);
  });

  test("学校 — finds 'school'", () => {
    const hits = simulateSmartLookup("学校に行く");
    expect(hitsContainWord(hits, "学校")).toBe(true);
    expect(hitsContainGloss(hits, "school")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. INFLECTED VERB LOOKUP — the key reader feature
// ═══════════════════════════════════════════════════════════════════

describe("Inflected verb lookup", () => {
  test("食べました (past polite) → 食べる", () => {
    const hits = simulateSmartLookup("食べました。");
    expect(hitsContainWord(hits, "食べる")).toBe(true);
    // Should have deinflection reason
    const hit = hits.find((h) => h.results.some((r) => r.kanjiTexts.includes("食べる")));
    expect(hit?.reasons.length).toBeGreaterThan(0);
  });

  test("書いた (godan past) → 書く", () => {
    const hits = simulateSmartLookup("書いた手紙");
    expect(hitsContainWord(hits, "書く")).toBe(true);
  });

  test("読んでいる (progressive) → includes 読む", () => {
    const hits = simulateSmartLookup("読んでいる本");
    // Should find 読む through deinflection chain
    expect(hitsContainWord(hits, "読む")).toBe(true);
  });

  test("走っている (progressive godan-る) → 走る", () => {
    const hits = simulateSmartLookup("走っている");
    expect(hitsContainWord(hits, "走る")).toBe(true);
  });

  test("話さない (negative) → 話す", () => {
    const hits = simulateSmartLookup("話さないでください");
    expect(hitsContainWord(hits, "話す")).toBe(true);
  });

  test("帰ります (polite) → 帰る", () => {
    const hits = simulateSmartLookup("帰ります");
    expect(hitsContainWord(hits, "帰る")).toBe(true);
  });

  test("泳いで (te-form) → 泳ぐ", () => {
    const hits = simulateSmartLookup("泳いでいる");
    expect(hitsContainWord(hits, "泳ぐ")).toBe(true);
  });

  test("遊んだ (past) → 遊ぶ", () => {
    const hits = simulateSmartLookup("遊んだ後");
    expect(hitsContainWord(hits, "遊ぶ")).toBe(true);
  });

  test("待って (te-form) → 待つ", () => {
    const hits = simulateSmartLookup("待ってください");
    expect(hitsContainWord(hits, "待つ")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. IRREGULAR VERB LOOKUP
// ═══════════════════════════════════════════════════════════════════

describe("Irregular verb lookup", () => {
  test("した (suru past) → する", () => {
    const hits = simulateSmartLookup("した事");
    expect(hitsContainWord(hits, "為る") || hitsContainWord(hits, "する")).toBe(true);
  });

  test("勉強しました (compound suru) → 勉強", () => {
    const hits = simulateSmartLookup("勉強しました");
    // Should find 勉強する or 勉強
    expect(hitsContainWord(hits, "勉強") || hitsContainGloss(hits, "study")).toBe(true);
  });

  test("来た (kuru past) → 来る", () => {
    const hits = simulateSmartLookup("来た人");
    expect(hitsContainWord(hits, "来る")).toBe(true);
  });

  test("行った (iku special past) → 行く", () => {
    const hits = simulateSmartLookup("行った事がある");
    expect(hitsContainWord(hits, "行く")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. ADJECTIVE LOOKUP
// ═══════════════════════════════════════════════════════════════════

describe("Adjective lookup", () => {
  test("高かった (past) → 高い", () => {
    const hits = simulateSmartLookup("高かった建物");
    expect(hitsContainWord(hits, "高い")).toBe(true);
  });

  test("寒くない (negative) → 寒い", () => {
    const hits = simulateSmartLookup("寒くないです");
    expect(hitsContainWord(hits, "寒い")).toBe(true);
  });

  test("美味しくて (te-form) → 美味しい", () => {
    const hits = simulateSmartLookup("美味しくて安い");
    expect(hitsContainWord(hits, "美味しい")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. LONGEST MATCH PREFERENCE
//    The system should prefer longer matches over shorter ones
// ═══════════════════════════════════════════════════════════════════

describe("Longest match preference", () => {
  test("学校 is found before 学 when tapping on 学校", () => {
    const hits = simulateSmartLookup("学校に行く");
    // First hit should be for the longer match
    const firstKanjiHit = hits.find((h) => h.results.some((r) => r.kanjiTexts.length > 0));
    if (firstKanjiHit) {
      // Matched text should be longer (学校) not shorter (学)
      expect(firstKanjiHit.matchedText.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("食べ物 is found as compound before 食べ or 食", () => {
    const hits = simulateSmartLookup("食べ物を買う");
    expect(hitsContainWord(hits, "食べ物")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. REAL READING SCENARIOS
//    Simulating actual sentences a user might encounter while reading
// ═══════════════════════════════════════════════════════════════════

describe("Real reading scenarios", () => {
  test("吾輩は猫である — finds the novel title entry", () => {
    const hits = simulateSmartLookup("吾輩は猫である");
    // The full phrase is a dictionary entry (I Am a Cat by Natsume Soseki)
    expect(hitsContainWord(hits, "吾輩は猫である")).toBe(true);
  });

  test("吾輩 — standalone lookup finds the word", () => {
    const hits = simulateSmartLookup("吾輩は");
    expect(hitsContainWord(hits, "吾輩")).toBe(true);
  });

  test("それから — conjunction", () => {
    const hits = simulateSmartLookup("それから彼は");
    expect(hitsContainWord(hits, "それから") || hitsContainGloss(hits, "and then")).toBe(true);
  });

  test("分からなかった — negative past of 分かる", () => {
    const hits = simulateSmartLookup("分からなかった");
    expect(hitsContainWord(hits, "分かる") || hitsContainWord(hits, "分る")).toBe(true);
  });

  test("思っていた — past progressive of 思う", () => {
    const hits = simulateSmartLookup("思っていた");
    expect(hitsContainWord(hits, "思う")).toBe(true);
  });

  test("見つけられなかった — potential negative past of 見つける", () => {
    const hits = simulateSmartLookup("見つけられなかった");
    // Through chain: 見つけられなかった → 見つけられる → 見つける
    expect(
      hitsContainWord(hits, "見つける") ||
        hitsContainWord(hits, "見つけられる") ||
        hitsContainGloss(hits, "find"),
    ).toBe(true);
  });

  test("kana-only word: おはよう", () => {
    const hits = simulateSmartLookup("おはようございます");
    expect(
      hitsContainWord(hits, "お早う") ||
        hitsContainGloss(hits, "good morning") ||
        hitsContainGloss(hits, "morning"),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. RESULT DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════

describe("Result deduplication", () => {
  test("same entry is not returned multiple times", () => {
    const hits = simulateSmartLookup("食べました");
    const allEntryIds = hits.flatMap((h) => h.results.map((r) => r.entryId));
    const unique = new Set(allEntryIds);
    expect(allEntryIds.length).toBe(unique.size);
  });

  test("食べる: multiple paths lead to same entry, but entry appears once", () => {
    // 食べた could match via ichidan past and other rules
    // The same 食べる entry should only appear once
    const hits = simulateSmartLookup("食べた");
    const taberuEntries = hits.flatMap((h) =>
      h.results.filter((r) => r.kanjiTexts.includes("食べる")),
    );
    const entryIds = taberuEntries.map((e) => e.entryId);
    const unique = new Set(entryIds);
    expect(entryIds.length).toBe(unique.size);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. EARLY STOP BEHAVIOR
// ═══════════════════════════════════════════════════════════════════

describe("Early stop behavior", () => {
  test("stops trying shorter substrings after finding results", () => {
    // For a long text, once we find matches we shouldn't keep going to length 1
    // This is a behavioral property — we check it by verifying we don't find
    // results for very short substrings when long ones already matched
    const hits = simulateSmartLookup("食べました。彼は走っている。");

    // We should have found 食べる (from 食べました)
    expect(hitsContainWord(hits, "食べる")).toBe(true);

    // The earliest (longest) matchedText should be long, not 1-2 chars
    expect(hits[0].matchedText.length).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. KATAKANA AND LOANWORDS
// ═══════════════════════════════════════════════════════════════════

describe("Katakana and loanwords", () => {
  test("コーヒー — coffee", () => {
    const hits = simulateSmartLookup("コーヒーを飲む");
    expect(hitsContainWord(hits, "コーヒー")).toBe(true);
    expect(hitsContainGloss(hits, "coffee")).toBe(true);
  });

  test("テレビ — television", () => {
    const hits = simulateSmartLookup("テレビを見る");
    expect(hitsContainWord(hits, "テレビ")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. EDGE CASES
// ═══════════════════════════════════════════════════════════════════

describe("Lookup edge cases", () => {
  test("single character: 日", () => {
    const hits = simulateSmartLookup("日");
    expect(hits.length).toBeGreaterThan(0);
  });

  test("particle-only: は", () => {
    const hits = simulateSmartLookup("は");
    // は should match the topic particle
    expect(hits.length).toBeGreaterThan(0);
  });

  test("very long text truncates to maxLen", () => {
    const longText = "私は毎朝六時に起きて朝ご飯を食べてから学校に行きます。";
    const hits = simulateSmartLookup(longText, 10);
    // Should not crash and should find something
    expect(hits.length).toBeGreaterThan(0);
    // First matched text should not exceed maxLen
    expect(hits[0].matchedText.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. TAP-OFFSET GREEDY LOOKUP (smartLookupWithOffset)
//     Simulates tapping on a character mid-word with backward context
// ═══════════════════════════════════════════════════════════════════

describe("Tap-offset greedy lookup (smartLookupWithOffset)", () => {
  test("tapping 積 in 蓄積させること → finds 蓄積, not 積もる", () => {
    // Simulate: text = "蓄積させること", tapOffset = 1 (tapped 積)
    const text = "蓄積させること";
    const tapOffset = 1; // index of 積
    const hits = simulateSmartLookupWithOffset(text, tapOffset);
    expect(hits.length).toBeGreaterThan(0);
    // Should find 蓄積 (accumulation)
    expect(hitsContainWord(hits, "蓄積")).toBe(true);
    // Should NOT match 積もる (the false positive from the bug)
    expect(hitsContainWord(hits, "積もる")).toBe(false);
  });

  test("tapping 蓄 in 蓄積させること → still finds 蓄積", () => {
    const text = "蓄積させること";
    const tapOffset = 0; // index of 蓄
    const hits = simulateSmartLookupWithOffset(text, tapOffset);
    expect(hits.length).toBeGreaterThan(0);
    expect(hitsContainWord(hits, "蓄積")).toBe(true);
  });
});
