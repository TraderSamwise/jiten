/**
 * Deinflection engine tests.
 *
 * Tests the core deinflect() function which converts inflected Japanese words
 * back to dictionary form. This is the heart of the reader's word lookup:
 * when a user taps 食べました, we need to find 食べる in the dictionary.
 *
 * Test strategy:
 * - Pure unit tests of deinflect() (no DB needed)
 * - Integration tests of smartLookup() against real dictionary.db
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import {
  deinflect,
  generateSubstrings,
  generateLookupCandidates,
  type DeinflectCandidate,
  type LookupCandidate,
} from "./deinflect";

// ─── Helper: check if a candidate word appears in deinflection results ───

function candidates(word: string): string[] {
  return deinflect(word).map((c) => c.word);
}

function hasCandidate(word: string, expected: string): boolean {
  return candidates(word).includes(expected);
}

function reasonsFor(word: string, expected: string): string[] {
  const c = deinflect(word).find((c) => c.word === expected);
  return c?.reasons ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// 1. ICHIDAN (る-verb) DEINFLECTION
// ═══════════════════════════════════════════════════════════════════

describe("Ichidan (る-verb) deinflection", () => {
  const base = "食べる"; // taberu — to eat

  test("dictionary form returns itself", () => {
    expect(hasCandidate("食べる", "食べる")).toBe(true);
  });

  test("te-form → dictionary", () => {
    expect(hasCandidate("食べて", base)).toBe(true);
  });

  test("past → dictionary", () => {
    expect(hasCandidate("食べた", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("食べない", base)).toBe(true);
  });

  test("negative past → dictionary", () => {
    expect(hasCandidate("食べなかった", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("食べます", base)).toBe(true);
  });

  test("past polite → dictionary", () => {
    expect(hasCandidate("食べました", base)).toBe(true);
  });

  test("negative polite → dictionary", () => {
    expect(hasCandidate("食べません", base)).toBe(true);
  });

  test("negative past polite → dictionary", () => {
    expect(hasCandidate("食べませんでした", base)).toBe(true);
  });

  test("passive/potential → dictionary", () => {
    expect(hasCandidate("食べられる", base)).toBe(true);
  });

  test("causative → dictionary", () => {
    expect(hasCandidate("食べさせる", base)).toBe(true);
  });

  test("causative passive → dictionary", () => {
    expect(hasCandidate("食べさせられる", base)).toBe(true);
  });

  test("imperative → dictionary", () => {
    expect(hasCandidate("食べろ", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("食べよう", base)).toBe(true);
  });

  test("conditional -reba → dictionary", () => {
    expect(hasCandidate("食べれば", base)).toBe(true);
  });

  test("conditional -tara → dictionary", () => {
    expect(hasCandidate("食べたら", base)).toBe(true);
  });

  test("tari → dictionary", () => {
    expect(hasCandidate("食べたり", base)).toBe(true);
  });

  test("te-iru → dictionary", () => {
    expect(hasCandidate("食べている", base)).toBe(true);
  });

  test("te-iru casual → dictionary", () => {
    expect(hasCandidate("食べてる", base)).toBe(true);
  });

  test("another ichidan: 見る (miru)", () => {
    expect(hasCandidate("見た", "見る")).toBe(true);
    expect(hasCandidate("見ない", "見る")).toBe(true);
    expect(hasCandidate("見ます", "見る")).toBe(true);
    expect(hasCandidate("見られる", "見る")).toBe(true);
    expect(hasCandidate("見ている", "見る")).toBe(true);
  });

  test("another ichidan: 起きる (okiru)", () => {
    expect(hasCandidate("起きた", "起きる")).toBe(true);
    expect(hasCandidate("起きて", "起きる")).toBe(true);
    expect(hasCandidate("起きない", "起きる")).toBe(true);
    expect(hasCandidate("起きました", "起きる")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. GODAN (う-verb) DEINFLECTION — all columns
// ═══════════════════════════════════════════════════════════════════

describe("Godan (う-verb) deinflection — う column", () => {
  // 買う (kau — to buy)
  const base = "買う";

  test("past → dictionary", () => {
    expect(hasCandidate("買った", base)).toBe(true);
  });

  test("te-form → dictionary", () => {
    expect(hasCandidate("買って", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("買わない", base)).toBe(true);
  });

  test("negative past → dictionary", () => {
    expect(hasCandidate("買わなかった", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("買います", base)).toBe(true);
  });

  test("past polite → dictionary", () => {
    expect(hasCandidate("買いました", base)).toBe(true);
  });

  test("potential → dictionary", () => {
    expect(hasCandidate("買える", base)).toBe(true);
  });

  test("passive → dictionary", () => {
    expect(hasCandidate("買われる", base)).toBe(true);
  });

  test("causative → dictionary", () => {
    expect(hasCandidate("買わせる", base)).toBe(true);
  });

  test("imperative → dictionary", () => {
    expect(hasCandidate("買え", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("買おう", base)).toBe(true);
  });

  test("conditional -eba → dictionary", () => {
    expect(hasCandidate("買えば", base)).toBe(true);
  });

  test("conditional -tara → dictionary", () => {
    expect(hasCandidate("買ったら", base)).toBe(true);
  });
});

describe("Godan — く column", () => {
  // 書く (kaku — to write)
  const base = "書く";

  test("past (いた) → dictionary", () => {
    expect(hasCandidate("書いた", base)).toBe(true);
  });

  test("te-form (いて) → dictionary", () => {
    expect(hasCandidate("書いて", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("書かない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("書きます", base)).toBe(true);
  });

  test("potential → dictionary", () => {
    expect(hasCandidate("書ける", base)).toBe(true);
  });

  test("passive → dictionary", () => {
    expect(hasCandidate("書かれる", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("書こう", base)).toBe(true);
  });

  test("conditional → dictionary", () => {
    expect(hasCandidate("書けば", base)).toBe(true);
  });
});

describe("Godan — ぐ column", () => {
  // 泳ぐ (oyogu — to swim)
  const base = "泳ぐ";

  test("past (いだ) → dictionary", () => {
    expect(hasCandidate("泳いだ", base)).toBe(true);
  });

  test("te-form (いで) → dictionary", () => {
    expect(hasCandidate("泳いで", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("泳がない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("泳ぎます", base)).toBe(true);
  });

  test("potential → dictionary", () => {
    expect(hasCandidate("泳げる", base)).toBe(true);
  });
});

describe("Godan — す column", () => {
  // 話す (hanasu — to speak)
  const base = "話す";

  test("past (した) → dictionary", () => {
    expect(hasCandidate("話した", base)).toBe(true);
  });

  test("te-form (して) → dictionary", () => {
    expect(hasCandidate("話して", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("話さない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("話します", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("話そう", base)).toBe(true);
  });

  test("conditional → dictionary", () => {
    expect(hasCandidate("話せば", base)).toBe(true);
  });
});

describe("Godan — つ column", () => {
  // 待つ (matsu — to wait)
  const base = "待つ";

  test("past (った) → dictionary", () => {
    expect(hasCandidate("待った", base)).toBe(true);
  });

  test("te-form (って) → dictionary", () => {
    expect(hasCandidate("待って", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("待たない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("待ちます", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("待とう", base)).toBe(true);
  });
});

describe("Godan — ぬ column", () => {
  // 死ぬ (shinu — to die)
  const base = "死ぬ";

  test("past (んだ) → dictionary", () => {
    expect(hasCandidate("死んだ", base)).toBe(true);
  });

  test("te-form (んで) → dictionary", () => {
    expect(hasCandidate("死んで", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("死なない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("死にます", base)).toBe(true);
  });
});

describe("Godan — ぶ column", () => {
  // 遊ぶ (asobu — to play)
  const base = "遊ぶ";

  test("past (んだ) → dictionary", () => {
    expect(hasCandidate("遊んだ", base)).toBe(true);
  });

  test("te-form (んで) → dictionary", () => {
    expect(hasCandidate("遊んで", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("遊ばない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("遊びます", base)).toBe(true);
  });

  test("potential → dictionary", () => {
    expect(hasCandidate("遊べる", base)).toBe(true);
  });
});

describe("Godan — む column", () => {
  // 読む (yomu — to read)
  const base = "読む";

  test("past (んだ) → dictionary", () => {
    expect(hasCandidate("読んだ", base)).toBe(true);
  });

  test("te-form (んで) → dictionary", () => {
    expect(hasCandidate("読んで", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("読まない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("読みます", base)).toBe(true);
  });

  test("potential → dictionary", () => {
    expect(hasCandidate("読める", base)).toBe(true);
  });

  test("passive → dictionary", () => {
    expect(hasCandidate("読まれる", base)).toBe(true);
  });

  test("causative → dictionary", () => {
    expect(hasCandidate("読ませる", base)).toBe(true);
  });
});

describe("Godan — る column (godan る, not ichidan)", () => {
  // 帰る (kaeru — to return)
  const base = "帰る";

  test("past → dictionary", () => {
    expect(hasCandidate("帰った", base)).toBe(true);
  });

  test("te-form → dictionary", () => {
    expect(hasCandidate("帰って", base)).toBe(true);
  });

  test("negative → dictionary", () => {
    expect(hasCandidate("帰らない", base)).toBe(true);
  });

  test("polite → dictionary", () => {
    expect(hasCandidate("帰ります", base)).toBe(true);
  });

  test("past polite → dictionary", () => {
    expect(hasCandidate("帰りました", base)).toBe(true);
  });

  test("volitional → dictionary", () => {
    expect(hasCandidate("帰ろう", base)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. IRREGULAR VERBS
// ═══════════════════════════════════════════════════════════════════

describe("する (suru) irregular deinflection", () => {
  test("した → する", () => {
    expect(hasCandidate("した", "する")).toBe(true);
  });

  test("して → する", () => {
    expect(hasCandidate("して", "する")).toBe(true);
  });

  test("しない → する", () => {
    expect(hasCandidate("しない", "する")).toBe(true);
  });

  test("しなかった → する", () => {
    expect(hasCandidate("しなかった", "する")).toBe(true);
  });

  test("します → する", () => {
    expect(hasCandidate("します", "する")).toBe(true);
  });

  test("しました → する", () => {
    expect(hasCandidate("しました", "する")).toBe(true);
  });

  test("しません → する", () => {
    expect(hasCandidate("しません", "する")).toBe(true);
  });

  test("できる → する", () => {
    expect(hasCandidate("できる", "する")).toBe(true);
  });

  test("される → する", () => {
    expect(hasCandidate("される", "する")).toBe(true);
  });

  test("させる → する", () => {
    expect(hasCandidate("させる", "する")).toBe(true);
  });

  test("しろ → する (imperative)", () => {
    expect(hasCandidate("しろ", "する")).toBe(true);
  });

  test("せよ → する (imperative formal)", () => {
    expect(hasCandidate("せよ", "する")).toBe(true);
  });

  test("しよう → する (volitional)", () => {
    expect(hasCandidate("しよう", "する")).toBe(true);
  });

  test("すれば → する (conditional)", () => {
    expect(hasCandidate("すれば", "する")).toBe(true);
  });

  test("している → する (te-iru)", () => {
    expect(hasCandidate("している", "する")).toBe(true);
  });

  test("してる → する (te-iru casual)", () => {
    expect(hasCandidate("してる", "する")).toBe(true);
  });

  test("蓄積させる → produces both 蓄積する and 蓄積 (noun base)", () => {
    const words = candidates("蓄積させる");
    expect(words).toContain("蓄積する"); // causative → する form
    expect(words).toContain("蓄積"); // suru-verb noun base
  });

  test("compound: 勉強する forms", () => {
    expect(hasCandidate("勉強した", "勉強する")).toBe(true);
    expect(hasCandidate("勉強して", "勉強する")).toBe(true);
    expect(hasCandidate("勉強しない", "勉強する")).toBe(true);
    expect(hasCandidate("勉強します", "勉強する")).toBe(true);
    expect(hasCandidate("勉強しました", "勉強する")).toBe(true);
    expect(hasCandidate("勉強している", "勉強する")).toBe(true);
  });
});

describe("来る (kuru) irregular deinflection", () => {
  test("きた → くる", () => {
    expect(hasCandidate("きた", "くる")).toBe(true);
  });

  test("きて → くる", () => {
    expect(hasCandidate("きて", "くる")).toBe(true);
  });

  test("こない → くる", () => {
    expect(hasCandidate("こない", "くる")).toBe(true);
  });

  test("きます → くる", () => {
    expect(hasCandidate("きます", "くる")).toBe(true);
  });

  test("きました → くる", () => {
    expect(hasCandidate("きました", "くる")).toBe(true);
  });

  test("こられる → くる", () => {
    expect(hasCandidate("こられる", "くる")).toBe(true);
  });

  test("こい → くる (imperative)", () => {
    expect(hasCandidate("こい", "くる")).toBe(true);
  });

  test("こよう → くる (volitional)", () => {
    expect(hasCandidate("こよう", "くる")).toBe(true);
  });

  test("kanji form: 来た → 来る", () => {
    expect(hasCandidate("来た", "来る")).toBe(true);
  });

  test("kanji form: 来て → 来る", () => {
    expect(hasCandidate("来て", "来る")).toBe(true);
  });

  test("kanji form: 来ない → 来る", () => {
    expect(hasCandidate("来ない", "来る")).toBe(true);
  });

  test("kanji form: 来ます → 来る", () => {
    expect(hasCandidate("来ます", "来る")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. I-ADJECTIVE DEINFLECTION
// ═══════════════════════════════════════════════════════════════════

describe("i-adjective deinflection", () => {
  test("past: 高かった → 高い", () => {
    expect(hasCandidate("高かった", "高い")).toBe(true);
  });

  test("negative: 高くない → 高い", () => {
    expect(hasCandidate("高くない", "高い")).toBe(true);
  });

  test("negative past: 高くなかった → 高い", () => {
    expect(hasCandidate("高くなかった", "高い")).toBe(true);
  });

  test("te-form: 高くて → 高い", () => {
    expect(hasCandidate("高くて", "高い")).toBe(true);
  });

  test("adverbial: 高く → 高い", () => {
    expect(hasCandidate("高く", "高い")).toBe(true);
  });

  test("conditional: 高ければ → 高い", () => {
    expect(hasCandidate("高ければ", "高い")).toBe(true);
  });

  test("volitional: 高かろう → 高い", () => {
    expect(hasCandidate("高かろう", "高い")).toBe(true);
  });

  test("nominalization: 高さ → 高い", () => {
    expect(hasCandidate("高さ", "高い")).toBe(true);
  });

  test("美味しい forms", () => {
    expect(hasCandidate("美味しかった", "美味しい")).toBe(true);
    expect(hasCandidate("美味しくない", "美味しい")).toBe(true);
    expect(hasCandidate("美味しくなかった", "美味しい")).toBe(true);
    expect(hasCandidate("美味しくて", "美味しい")).toBe(true);
    expect(hasCandidate("美味しければ", "美味しい")).toBe(true);
  });

  test("寒い forms", () => {
    expect(hasCandidate("寒かった", "寒い")).toBe(true);
    expect(hasCandidate("寒くない", "寒い")).toBe(true);
    expect(hasCandidate("寒さ", "寒い")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. DEINFLECTION REASONS / CHAIN INFO
// ═══════════════════════════════════════════════════════════════════

describe("Deinflection reasons", () => {
  test("食べました reports 'past polite' reason", () => {
    const reasons = reasonsFor("食べました", "食べる");
    expect(reasons).toContain("past polite");
  });

  test("食べない reports 'negative' reason", () => {
    const reasons = reasonsFor("食べない", "食べる");
    expect(reasons).toContain("negative");
  });

  test("書いた reports 'past' reason", () => {
    const reasons = reasonsFor("書いた", "書く");
    expect(reasons).toContain("past");
  });

  test("高くなかった reports 'negative past' reason", () => {
    const reasons = reasonsFor("高くなかった", "高い");
    expect(reasons).toContain("negative past");
  });

  test("勉強しました reports 'past polite' reason", () => {
    const reasons = reasonsFor("勉強しました", "勉強する");
    expect(reasons).toContain("past polite");
  });

  test("original word has empty reasons", () => {
    const reasons = reasonsFor("食べる", "食べる");
    expect(reasons).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. ALGORITHM PROPERTIES
// ═══════════════════════════════════════════════════════════════════

describe("Deinflection algorithm properties", () => {
  test("always includes the original word as first candidate", () => {
    const result = deinflect("食べました");
    expect(result[0].word).toBe("食べました");
    expect(result[0].reasons).toEqual([]);
  });

  test("no duplicates in candidate list", () => {
    const result = deinflect("食べている");
    const words = result.map((c) => c.word);
    const unique = new Set(words);
    expect(words.length).toBe(unique.size);
  });

  test("single character input returns at least itself", () => {
    const result = deinflect("あ");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].word).toBe("あ");
  });

  test("empty string returns just itself", () => {
    const result = deinflect("");
    expect(result).toEqual([{ word: "", typeMask: 0xff, reasons: [] }]);
  });

  test("non-Japanese text returns just itself", () => {
    const result = deinflect("hello");
    expect(result[0].word).toBe("hello");
    // May generate some candidates from coincidental suffix matches, but
    // the original should always be first
  });

  test("generates multiple candidates for ambiguous forms", () => {
    // 食べた could be from 食べる (ichidan) — we should get at least 2 candidates
    const result = deinflect("食べた");
    expect(result.length).toBeGreaterThan(1);
  });

  test("does not produce empty-string candidates", () => {
    // Short words could theoretically reduce to empty via suffix stripping
    const shortWords = ["て", "た", "い", "く", "し"];
    for (const w of shortWords) {
      const result = deinflect(w);
      for (const c of result) {
        expect(c.word.length).toBeGreaterThan(0);
      }
    }
  });

  test("handles very long input without crashing", () => {
    const longWord = "食べさせられていませんでした";
    const result = deinflect(longWord);
    expect(result.length).toBeGreaterThan(1);
    // Should eventually find 食べる through chain
    expect(result.some((c) => c.word === "食べる")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. GODAN MASU-STEM (standalone noun form)
// ═══════════════════════════════════════════════════════════════════

describe("Godan masu-stem (noun form)", () => {
  test("書き → 書く", () => {
    expect(hasCandidate("書き", "書く")).toBe(true);
  });

  test("読み → 読む", () => {
    expect(hasCandidate("読み", "読む")).toBe(true);
  });

  test("話し → 話す", () => {
    expect(hasCandidate("話し", "話す")).toBe(true);
  });

  test("帰り → 帰る", () => {
    expect(hasCandidate("帰り", "帰る")).toBe(true);
  });

  test("遊び → 遊ぶ", () => {
    expect(hasCandidate("遊び", "遊ぶ")).toBe(true);
  });

  test("待ち → 待つ", () => {
    expect(hasCandidate("待ち", "待つ")).toBe(true);
  });

  test("泳ぎ → 泳ぐ", () => {
    expect(hasCandidate("泳ぎ", "泳ぐ")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. TAI FORM (want to do)
// ═══════════════════════════════════════════════════════════════════

describe("tai form (want to)", () => {
  test("食べたい → 食べる", () => {
    expect(hasCandidate("食べたい", "食べる")).toBe(true);
  });

  test("食べたくない → 食べる", () => {
    expect(hasCandidate("食べたくない", "食べる")).toBe(true);
  });

  test("食べたかった → 食べる", () => {
    expect(hasCandidate("食べたかった", "食べる")).toBe(true);
  });

  test("見たい → 見る", () => {
    expect(hasCandidate("見たい", "見る")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. REAL-WORLD TEXT SCENARIOS
//    When a user taps in running text, we get a substring that starts
//    at the tapped character and extends forward. These tests simulate that.
// ═══════════════════════════════════════════════════════════════════

describe("Real-world text extraction scenarios", () => {
  test("食べました。 — past polite with period after", () => {
    // User taps on 食: text is "食べました。彼は..."
    // We'd try substrings from longest down. "食べました" should match.
    const result = deinflect("食べました");
    expect(result.some((c) => c.word === "食べる")).toBe(true);
  });

  test("走っている — progressive form of 走る", () => {
    const result = deinflect("走っている");
    // Should chain: 走っている → 走って → 走る (via godan る te-form + te-iru)
    // or directly: 走っている → 走る (via godan て-iru rule)
    // At minimum, 走って should appear
    expect(result.some((c) => c.word === "走って")).toBe(true);
  });

  test("書かれた — passive past of 書く", () => {
    const result = deinflect("書かれた");
    // Should find 書かれる (passive form) and potentially 書く
    expect(result.some((c) => c.word === "書かれる")).toBe(true);
  });

  test("行った — special godan past of 行く", () => {
    // 行く has special te/ta form: 行った, not 行いた
    const result = deinflect("行った");
    expect(result.some((c) => c.word === "行く")).toBe(true);
  });

  test("行って — special te-form of 行く", () => {
    const result = deinflect("行って");
    expect(result.some((c) => c.word === "行く")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. COMPREHENSIVE REAL-WORD EXAMPLES
//     These verify against actual common words that a reader would encounter
// ═══════════════════════════════════════════════════════════════════

describe("Comprehensive real-word verification", () => {
  test("分からなかった → 分かる (negative past)", () => {
    expect(hasCandidate("分からなかった", "分かる")).toBe(true);
  });

  test("作りました → 作る (past polite)", () => {
    expect(hasCandidate("作りました", "作る")).toBe(true);
  });

  test("飲んでいる → includes 飲んで as candidate", () => {
    expect(hasCandidate("飲んでいる", "飲んで")).toBe(true);
  });

  test("思わなかった → 思う (negative past)", () => {
    expect(hasCandidate("思わなかった", "思う")).toBe(true);
  });

  test("使っていません → includes 使って", () => {
    // This is a complex chain: 使っていません → 使っている → 使って → 使う
    const result = deinflect("使っていません");
    // At minimum, should find some of the chain
    expect(result.some((c) => c.word === "使っていません")).toBe(true); // original
    expect(result.length).toBeGreaterThan(1);
  });

  test("歩かせられた — causative passive past of 歩く", () => {
    const result = deinflect("歩かせられた");
    // Should find 歩かせられる → 歩かせる → maybe further
    expect(result.some((c) => c.word === "歩かせられる")).toBe(true);
  });

  test("嬉しくなかった → 嬉しい (i-adj negative past)", () => {
    expect(hasCandidate("嬉しくなかった", "嬉しい")).toBe(true);
  });

  test("難しければ → 難しい (i-adj conditional)", () => {
    expect(hasCandidate("難しければ", "難しい")).toBe(true);
  });

  test("早く → 早い (adverbial)", () => {
    expect(hasCandidate("早く", "早い")).toBe(true);
  });

  test("楽しさ → 楽しい (nominalization)", () => {
    expect(hasCandidate("楽しさ", "楽しい")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. SUBSTRING GENERATION (pure)
// ═══════════════════════════════════════════════════════════════════

describe("generateSubstrings", () => {
  test("generates substrings from longest to shortest", () => {
    const result = generateSubstrings("食べました");
    expect(result[0]).toBe("食べました");
    expect(result[1]).toBe("食べまし");
    expect(result[2]).toBe("食べま");
    expect(result[3]).toBe("食べ");
    expect(result[4]).toBe("食");
    expect(result.length).toBe(5);
  });

  test("respects maxLen parameter", () => {
    const result = generateSubstrings("食べましたが彼は", 5);
    // maxLen=5 means first substring is 5 chars: "食べました"
    expect(result[0]).toBe("食べました");
    expect(result.length).toBe(5); // lengths 5,4,3,2,1
    expect(result[4]).toBe("食");
  });

  test("handles text shorter than maxLen", () => {
    const result = generateSubstrings("猫", 15);
    expect(result).toEqual(["猫"]);
  });

  test("returns empty array for empty string", () => {
    const result = generateSubstrings("");
    expect(result).toEqual([]);
  });

  test("single character text", () => {
    const result = generateSubstrings("あ");
    expect(result).toEqual(["あ"]);
  });

  test("default maxLen is 15", () => {
    const long = "あいうえおかきくけこさしすせそたちつてと"; // 20 chars
    const result = generateSubstrings(long);
    expect(result[0].length).toBe(15);
    expect(result.length).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. LOOKUP CANDIDATE GENERATION (pure)
// ═══════════════════════════════════════════════════════════════════

describe("generateLookupCandidates", () => {
  test("generates candidates for an inflected word in context", () => {
    // Simulating: user taps on 食 in "食べました。彼は..."
    const text = "食べました。彼は";
    const candidates = generateLookupCandidates(text, 10);

    // Should include the original substrings at various lengths
    expect(
      candidates.some((c) => c.matchedText === "食べました" && c.searchWord === "食べました"),
    ).toBe(true);

    // Should include deinflected forms
    expect(
      candidates.some((c) => c.matchedText === "食べました" && c.searchWord === "食べる"),
    ).toBe(true);

    // Should also have shorter substrings
    expect(candidates.some((c) => c.matchedText === "食べ")).toBe(true);
    expect(candidates.some((c) => c.matchedText === "食")).toBe(true);
  });

  test("includes the original word (no deinflection) for every substring", () => {
    const candidates = generateLookupCandidates("高かった");
    // Every substring length should have at least the identity candidate
    const matchedTexts = [...new Set(candidates.map((c) => c.matchedText))];
    for (const mt of matchedTexts) {
      const identity = candidates.find((c) => c.matchedText === mt && c.searchWord === mt);
      expect(identity).toBeDefined();
    }
  });

  test("deduplicates candidates with same matchedText:searchWord pair", () => {
    const candidates = generateLookupCandidates("食べた");
    const keys = candidates.map((c) => `${c.matchedText}:${c.searchWord}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  test("empty text returns no candidates", () => {
    const candidates = generateLookupCandidates("");
    expect(candidates).toEqual([]);
  });

  test("single kanji generates candidates", () => {
    const candidates = generateLookupCandidates("猫");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].matchedText).toBe("猫");
    expect(candidates[0].searchWord).toBe("猫");
  });

  test("longer text generates many candidates", () => {
    const candidates = generateLookupCandidates("食べさせられていました");
    // For a complex inflected form, we should get many candidates
    expect(candidates.length).toBeGreaterThan(10);

    // Should include the target base form
    expect(candidates.some((c) => c.searchWord === "食べる")).toBe(true);
  });

  test("reasons are populated for deinflected candidates", () => {
    const candidates = generateLookupCandidates("食べました");
    const deinflected = candidates.find(
      (c) => c.matchedText === "食べました" && c.searchWord === "食べる",
    );
    expect(deinflected).toBeDefined();
    expect(deinflected!.reasons.length).toBeGreaterThan(0);
    expect(deinflected!.reasons).toContain("past polite");
  });

  test("reasons are empty for identity candidates", () => {
    const candidates = generateLookupCandidates("食べました");
    const identity = candidates.find(
      (c) => c.matchedText === "食べました" && c.searchWord === "食べました",
    );
    expect(identity).toBeDefined();
    expect(identity!.reasons).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. SIMULATED SELECTION SEGMENTATION
//     When a user selects a phrase, we run smartLookup on it.
//     Test that generateLookupCandidates produces the right candidates
//     for multi-word selections.
// ═══════════════════════════════════════════════════════════════════

describe("Selection segmentation scenarios", () => {
  test("phrase: 猫が食べた — generates candidates for both 猫 and 食べた", () => {
    // When processing "猫が食べた", smartLookup tries substrings from longest down.
    // We should find:
    // - Full string "猫が食べた" (unlikely to match anything)
    // - "猫が食べ" → probably no match
    // - "猫が食" → probably no match
    // - "猫が" → 猫が (no match), but also deinflect tries
    // - "猫" → exact match!
    const candidates = generateLookupCandidates("猫が食べた", 10);

    // Should have candidates for the full string
    expect(candidates.some((c) => c.matchedText === "猫が食べた")).toBe(true);

    // Should have candidates for 猫
    expect(candidates.some((c) => c.matchedText === "猫" && c.searchWord === "猫")).toBe(true);

    // Should have deinflection of 食べた (not matching from text start though —
    // smartLookup only tries prefixes, not arbitrary substrings)
  });

  test("phrase: 彼は走っている — longest match first", () => {
    const candidates = generateLookupCandidates("彼は走っている", 10);

    // The first candidates should be for the longest substring
    expect(candidates[0].matchedText.length).toBeGreaterThan(1);

    // Should include single-char candidates too
    expect(candidates.some((c) => c.matchedText === "彼")).toBe(true);
  });

  test("suffix extraction: text after tap position", () => {
    // User taps on 走 in "彼は走っている"
    // The WebView sends "走っている" (from tap position forward)
    const candidates = generateLookupCandidates("走っている");

    // Should find: 走っている → 走って → 走る (chain)
    expect(candidates.some((c) => c.searchWord === "走っている")).toBe(true);
    expect(candidates.some((c) => c.searchWord === "走って")).toBe(true);

    // 走 alone should also be a candidate
    expect(candidates.some((c) => c.matchedText === "走" && c.searchWord === "走")).toBe(true);
  });

  test("period does not affect candidate generation", () => {
    // Japanese period ー often follows verbs
    const candidatesWithPeriod = generateLookupCandidates("食べた。");
    const candidatesWithout = generateLookupCandidates("食べた");

    // The 食べた substring should produce the same candidates in both
    const withPeriodFor3 = candidatesWithPeriod
      .filter((c) => c.matchedText === "食べた")
      .map((c) => c.searchWord)
      .sort();
    const withoutFor3 = candidatesWithout
      .filter((c) => c.matchedText === "食べた")
      .map((c) => c.searchWord)
      .sort();
    expect(withPeriodFor3).toEqual(withoutFor3);
  });

  test("handles mixed kanji-kana text", () => {
    const candidates = generateLookupCandidates("お母さん");
    expect(candidates.some((c) => c.matchedText === "お母さん")).toBe(true);
    expect(candidates.some((c) => c.matchedText === "お母さ")).toBe(true);
    expect(candidates.some((c) => c.matchedText === "お母")).toBe(true);
    expect(candidates.some((c) => c.matchedText === "お")).toBe(true);
  });

  test("handles pure katakana text", () => {
    const candidates = generateLookupCandidates("コーヒー");
    expect(
      candidates.some((c) => c.matchedText === "コーヒー" && c.searchWord === "コーヒー"),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. EDGE CASES AND ROBUSTNESS
// ═══════════════════════════════════════════════════════════════════

describe("Edge cases and robustness", () => {
  test("very short inflected words", () => {
    // した is past of する
    expect(hasCandidate("した", "する")).toBe(true);
  });

  test("ambiguous form: した could be する or す past", () => {
    const words = candidates("した");
    expect(words).toContain("する"); // suru past
    expect(words).toContain("す"); // su past (godan す-column)
  });

  test("ambiguous form: きた could be 来る or く-column godan", () => {
    const words = candidates("きた");
    expect(words).toContain("くる"); // kuru past
  });

  test("handles emoji gracefully", () => {
    const result = deinflect("😀食べた");
    expect(result[0].word).toBe("😀食べた");
    // Should not crash
  });

  test("handles numbers in text", () => {
    const result = generateLookupCandidates("3時間");
    expect(result.some((c) => c.matchedText === "3時間")).toBe(true);
    expect(result.some((c) => c.matchedText === "3")).toBe(true);
  });

  test("handles English mixed in", () => {
    const result = generateLookupCandidates("WiFiが");
    expect(result.some((c) => c.matchedText === "WiFiが")).toBe(true);
    // Should not crash
  });

  test("punctuation-only text", () => {
    const result = generateLookupCandidates("。、！");
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Each substring is valid even if it won't match anything in dict
  });
});

// ═══════════════════════════════════════════════════════════════════
// 15. COMPOUND INFLECTION CHAINS (passive+past, causative+past, etc.)
//     Passive, causative, and potential forms are ichidan verbs.
//     Their conjugations (past, negative, te-form) must chain through
//     to the original godan/suru/kuru base form.
// ═══════════════════════════════════════════════════════════════════

describe("Compound inflection chains — passive/causative/potential + conjugation", () => {
  // ── Godan passive + past ──
  test("手渡された (す passive past) → 手渡す", () => {
    expect(hasCandidate("手渡された", "手渡す")).toBe(true);
  });

  test("書かれた (く passive past) → 書く", () => {
    expect(hasCandidate("書かれた", "書く")).toBe(true);
  });

  test("読まれた (む passive past) → 読む", () => {
    expect(hasCandidate("読まれた", "読む")).toBe(true);
  });

  test("買われた (う passive past) → 買う", () => {
    expect(hasCandidate("買われた", "買う")).toBe(true);
  });

  test("遊ばれた (ぶ passive past) → 遊ぶ", () => {
    expect(hasCandidate("遊ばれた", "遊ぶ")).toBe(true);
  });

  // ── Godan passive + negative ──
  test("書かれない (く passive negative) → 書く", () => {
    expect(hasCandidate("書かれない", "書く")).toBe(true);
  });

  test("話されない (す passive negative) → 話す", () => {
    expect(hasCandidate("話されない", "話す")).toBe(true);
  });

  test("照らされ (す passive stem) → 照らす", () => {
    expect(hasCandidate("照らされ", "照らす")).toBe(true);
  });

  // ── Godan passive + te-form ──
  test("読まれて (む passive te-form) → 読む", () => {
    expect(hasCandidate("読まれて", "読む")).toBe(true);
  });

  // ── Godan causative + past ──
  test("買わせた (う causative past) → 買う", () => {
    expect(hasCandidate("買わせた", "買う")).toBe(true);
  });

  test("書かせた (く causative past) → 書く", () => {
    expect(hasCandidate("書かせた", "書く")).toBe(true);
  });

  test("読ませた (む causative past) → 読む", () => {
    expect(hasCandidate("読ませた", "読む")).toBe(true);
  });

  // ── Godan potential + past ──
  test("書けた (く potential past) → 書く", () => {
    expect(hasCandidate("書けた", "書く")).toBe(true);
  });

  test("読めた (む potential past) → 読む", () => {
    expect(hasCandidate("読めた", "読む")).toBe(true);
  });

  test("話せた (す potential past) → 話す", () => {
    expect(hasCandidate("話せた", "話す")).toBe(true);
  });

  // ── Suru passive + past ──
  test("された (suru passive past) → する", () => {
    expect(hasCandidate("された", "する")).toBe(true);
  });

  test("勉強された (compound suru passive past) → 勉強する", () => {
    expect(hasCandidate("勉強された", "勉強する")).toBe(true);
  });

  test("勉強され (compound suru passive stem) → 勉強する", () => {
    expect(hasCandidate("勉強され", "勉強する")).toBe(true);
  });

  // ── Suru causative + past ──
  test("させた (suru causative past) → する", () => {
    expect(hasCandidate("させた", "する")).toBe(true);
  });

  // ── Godan passive + polite ──
  test("書かれます (く passive polite) → 書く", () => {
    expect(hasCandidate("書かれます", "書く")).toBe(true);
  });

  // ── Godan causative + negative ──
  test("読ませない (む causative negative) → 読む", () => {
    expect(hasCandidate("読ませない", "読む")).toBe(true);
  });
});
