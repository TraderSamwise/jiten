import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getKanji,
  getSimilarKanji,
  searchKanjiByMeaning,
  getSimilarByMeaning,
} from "./kanji-search";

let db: Database.Database;

/** Minimal schema matching the build script's output. */
function setupTestDb(d: Database.Database) {
  d.exec(`
    CREATE TABLE kanji_characters (
      literal TEXT PRIMARY KEY,
      grade INTEGER,
      stroke_count INTEGER NOT NULL,
      frequency_rank INTEGER,
      jlpt_old INTEGER,
      jlpt_level INTEGER,
      readings_on TEXT,
      readings_kun TEXT,
      meanings TEXT,
      nanori TEXT,
      radical_classical INTEGER,
      radical_nelson INTEGER,
      heisig_index INTEGER,
      unicode_codepoint TEXT NOT NULL,
      stroke_paths TEXT,
      similarity_vector BLOB
    );

    CREATE TABLE kanji_similarity (
      literal TEXT NOT NULL,
      similar TEXT NOT NULL,
      score REAL NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY (literal, similar)
    );

    CREATE VIRTUAL TABLE kanji_meanings_fts USING fts5(
      meanings, literal UNINDEXED,
      tokenize='porter unicode61'
    );
  `);

  const insert = d.prepare(`
    INSERT INTO kanji_characters
    (literal, stroke_count, frequency_rank, meanings, readings_on, readings_kun, nanori, unicode_codepoint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Test kanji with overlapping meanings
  insert.run("火", 4, 574, '["fire"]', '["カ"]', '["ひ"]', "[]", "U+706B");
  insert.run(
    "炎",
    8,
    1816,
    '["inflammation","flame","blaze"]',
    '["エン"]',
    '["ほのお"]',
    "[]",
    "U+708E",
  );
  insert.run("燃", 16, 1028, '["burn","blaze","glow"]', '["ネン"]', '["も.える"]', "[]", "U+71C3");
  insert.run(
    "灯",
    6,
    1557,
    '["lamp","light","counter for lights"]',
    '["トウ"]',
    '["ひ"]',
    "[]",
    "U+706F",
  );
  insert.run(
    "穏",
    16,
    1535,
    '["calm","quiet","moderation"]',
    '["オン"]',
    '["おだ.やか"]',
    "[]",
    "U+7A4F",
  );
  insert.run("静", 14, 762, '["quiet","calm"]', '["セイ"]', '["しず.か"]', "[]", "U+9759");
  insert.run(
    "安",
    6,
    144,
    '["relax","cheap","low","quiet","rested"]',
    '["アン"]',
    '["やす.い"]',
    "[]",
    "U+5B89",
  );
  insert.run("温", 12, 755, '["warm","moderation"]', '["オン"]', '["あたた.かい"]', "[]", "U+6E29");
  insert.run("水", 4, 223, '["water"]', '["スイ"]', '["みず"]', "[]", "U+6C34");
  insert.run("山", 3, 131, '["mountain"]', '["サン"]', '["やま"]', "[]", "U+5C71");

  // Similarity data
  const insertSim = d.prepare(
    "INSERT INTO kanji_similarity (literal, similar, score, rank) VALUES (?, ?, ?, ?)",
  );
  insertSim.run("火", "炎", 0.72, 1);
  insertSim.run("火", "灯", 0.65, 2);

  // Populate FTS
  d.exec(`
    INSERT INTO kanji_meanings_fts (meanings, literal)
    SELECT meanings, literal FROM kanji_characters WHERE meanings IS NOT NULL
  `);
}

beforeAll(() => {
  db = new Database(":memory:");
  setupTestDb(db);
});

afterAll(() => {
  db.close();
});

describe("getKanji", () => {
  it("returns a kanji by literal", () => {
    const k = getKanji(db as unknown as Parameters<typeof getKanji>[0], "火");
    expect(k).not.toBeNull();
    expect(k!.literal).toBe("火");
    expect(k!.meanings).toContain("fire");
    expect(k!.strokeCount).toBe(4);
  });

  it("returns null for unknown kanji", () => {
    const k = getKanji(db as unknown as Parameters<typeof getKanji>[0], "🚀");
    expect(k).toBeNull();
  });
});

describe("getSimilarKanji", () => {
  it("returns visually similar kanji ordered by rank", () => {
    const results = getSimilarKanji(db as unknown as Parameters<typeof getSimilarKanji>[0], "火");
    expect(results).toHaveLength(2);
    expect(results[0].literal).toBe("炎");
    expect(results[0].score).toBeCloseTo(0.72);
    expect(results[1].literal).toBe("灯");
  });

  it("returns empty array for kanji with no similarity data", () => {
    const results = getSimilarKanji(db as unknown as Parameters<typeof getSimilarKanji>[0], "水");
    expect(results).toHaveLength(0);
  });
});

describe("searchKanjiByMeaning", () => {
  it("finds kanji by English meaning", () => {
    const results = searchKanjiByMeaning(
      db as unknown as Parameters<typeof searchKanjiByMeaning>[0],
      "quiet",
    );
    const literals = results.map((k) => k.literal);
    expect(literals).toContain("穏");
    expect(literals).toContain("静");
    expect(literals).toContain("安");
  });

  it("uses porter stemming (e.g. 'burning' matches 'burn')", () => {
    const results = searchKanjiByMeaning(
      db as unknown as Parameters<typeof searchKanjiByMeaning>[0],
      "burning",
    );
    const literals = results.map((k) => k.literal);
    expect(literals).toContain("燃");
  });
});

describe("getSimilarByMeaning", () => {
  it("returns kanji with similar meanings, excluding the target", () => {
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "穏",
    );
    const literals = results.map((k) => k.literal);
    expect(literals).not.toContain("穏");
    // 静 has "quiet" and "calm", 安 has "quiet", 温 has "moderation"
    expect(literals).toContain("静");
    expect(literals).toContain("安");
    expect(literals).toContain("温");
  });

  it("orders results by frequency rank", () => {
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "穏",
    );
    // All results should have ascending frequency_rank (lower = more common)
    const ranks = results.map((k) => k.frequencyRank).filter((r) => r != null) as number[];
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it("returns empty array for kanji with no meanings", () => {
    // Insert a kanji with no meanings
    (db as Database.Database).exec(`
      INSERT INTO kanji_characters (literal, stroke_count, unicode_codepoint)
      VALUES ('〇', 1, 'U+3007')
    `);
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "〇",
    );
    expect(results).toHaveLength(0);
  });

  it("returns empty array for unknown kanji", () => {
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "🚀",
    );
    expect(results).toHaveLength(0);
  });

  it("respects the limit parameter", () => {
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "穏",
      2,
    );
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("finds kanji sharing blaze meaning for 炎", () => {
    const results = getSimilarByMeaning(
      db as unknown as Parameters<typeof getSimilarByMeaning>[0],
      "炎",
    );
    const literals = results.map((k) => k.literal);
    // 燃 has "blaze"
    expect(literals).toContain("燃");
    expect(literals).not.toContain("炎");
  });
});
