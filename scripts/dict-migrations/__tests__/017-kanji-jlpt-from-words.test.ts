import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(__dirname, "../../../assets/dictionary.db");

/**
 * Derive JLPT level for each jouyou kanji from the easiest JLPT word containing it.
 * Returns a map of literal → { derivedLevel, sourceWord, sourceEntryId }
 */
function deriveKanjiJlptLevels(db: Database.Database) {
  // 1. Load all kanji.text → entry_id mappings
  const kanjiRows = db.prepare("SELECT text, entry_id FROM kanji").all() as {
    text: string;
    entry_id: number;
  }[];

  // 2. Load all entries with jlpt_level and common flag
  const entryRows = db
    .prepare("SELECT id, jlpt_level, common FROM entries WHERE jlpt_level IS NOT NULL")
    .all() as { id: number; jlpt_level: number; common: number }[];

  const entryMap = new Map<number, { jlpt_level: number; common: number }>();
  for (const row of entryRows) {
    entryMap.set(row.id, { jlpt_level: row.jlpt_level, common: row.common });
  }

  // 3. Build a map: for each kanji.text, store the entry's jlpt info
  //    We need: for each character in kanji.text, find the best (highest-numbered = easiest) JLPT level
  //    from common words containing that character.

  // Build character → best entry info
  const charBest = new Map<string, { level: number; word: string; entryId: number }>();

  for (const row of kanjiRows) {
    const entry = entryMap.get(row.entry_id);
    if (!entry || !entry.common) continue;

    // For each unique kanji character in this word
    const seen = new Set<string>();
    for (const ch of row.text) {
      if (seen.has(ch)) continue;
      seen.add(ch);

      // Check if this character is a CJK ideograph (kanji)
      const code = ch.codePointAt(0)!;
      if (code < 0x4e00 || code > 0x9fff) continue;

      const current = charBest.get(ch);
      if (!current || entry.jlpt_level > current.level) {
        charBest.set(ch, {
          level: entry.jlpt_level,
          word: row.text,
          entryId: row.entry_id,
        });
      }
    }
  }

  return charBest;
}

describe("Kanji JLPT derivation from words", () => {
  it("should derive correct JLPT levels for jouyou kanji", () => {
    const db = new Database(DB_PATH, { readonly: true });

    const charBest = deriveKanjiJlptLevels(db);

    // Load jouyou kanji (grade 1-8)
    const jouyouKanji = db
      .prepare(
        "SELECT literal, grade, jlpt_level FROM kanji_characters WHERE grade BETWEEN 1 AND 8 ORDER BY grade, literal",
      )
      .all() as { literal: string; grade: number; jlpt_level: number | null }[];

    // Build full audit table
    const rows: {
      literal: string;
      grade: number;
      currentLevel: number | null;
      derivedLevel: number | null;
      sourceWord: string | null;
    }[] = [];

    for (const k of jouyouKanji) {
      const derived = charBest.get(k.literal);
      rows.push({
        literal: k.literal,
        grade: k.grade,
        currentLevel: k.jlpt_level,
        derivedLevel: derived?.level ?? null,
        sourceWord: derived?.word ?? null,
      });
    }

    // Print full table
    console.log("\n=== FULL JOUYOU KANJI JLPT AUDIT ===");
    console.log("Literal | Grade | Current | Derived | Source Word");
    console.log("--------|-------|---------|---------|------------");
    for (const r of rows) {
      const cur = r.currentLevel != null ? `N${r.currentLevel}` : "  -";
      const der = r.derivedLevel != null ? `N${r.derivedLevel}` : "  -";
      console.log(
        `  ${r.literal}    |   ${r.grade}   |   ${cur}   |   ${der}   | ${r.sourceWord ?? "(none)"}`,
      );
    }

    // Distribution
    const distCurrent = new Map<string, number>();
    const distDerived = new Map<string, number>();
    for (const r of rows) {
      const ck = r.currentLevel != null ? `N${r.currentLevel}` : "NULL";
      const dk = r.derivedLevel != null ? `N${r.derivedLevel}` : "NULL";
      distCurrent.set(ck, (distCurrent.get(ck) ?? 0) + 1);
      distDerived.set(dk, (distDerived.get(dk) ?? 0) + 1);
    }

    console.log("\n=== DISTRIBUTION ===");
    console.log("Level    | Current | Derived");
    console.log("---------|---------|--------");
    for (const level of ["N1", "N2", "N3", "N4", "N5", "NULL"]) {
      console.log(
        `${level.padEnd(8)} | ${String(distCurrent.get(level) ?? 0).padStart(5)}   | ${String(distDerived.get(level) ?? 0).padStart(5)}`,
      );
    }

    // Kanji that changed level
    const changed = rows.filter((r) => r.currentLevel !== r.derivedLevel && r.derivedLevel != null);
    console.log(`\n=== CHANGES: ${changed.length} kanji would change level ===`);

    // Kanji with no JLPT words (would need frequency fallback)
    const noMatch = rows.filter((r) => r.derivedLevel == null);
    console.log(
      `\n=== NO JLPT WORDS (need frequency fallback): ${noMatch.length} jouyou kanji ===`,
    );
    for (const r of noMatch) {
      console.log(
        `  ${r.literal} (grade ${r.grade}, current: ${r.currentLevel != null ? `N${r.currentLevel}` : "NULL"})`,
      );
    }

    db.close();

    // Assertions
    const getLevel = (ch: string) => charBest.get(ch)?.level ?? null;

    // Basic kanji should be N5
    expect(getLevel("日")).toBe(5);
    expect(getLevel("出")).toBe(5);
    expect(getLevel("食")).toBe(5);
    expect(getLevel("飲")).toBe(5);
    expect(getLevel("読")).toBe(5);
    expect(getLevel("書")).toBe(5);

    // Currently wrong levels that should be fixed
    expect(getLevel("隣")).toBe(5); // 隣り is N5 word, currently N1
    expect(getLevel("姿")).toBe(3); // 姿 word is N3, currently N1
    expect(getLevel("犬")).toBe(5); // currently N4
    expect(getLevel("猫")).toBe(5); // currently N2
    expect(getLevel("難")).toBe(5); // 難しい is N5

    // N3 count must be > 0 (currently zero)
    expect(distDerived.get("N3") ?? 0).toBeGreaterThan(0);
  });
});
