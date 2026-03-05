import type Database from "better-sqlite3";
import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 18,
  description: "Derive kanji JLPT levels from word JLPT data",
  async migrate(db) {
    // 1. Load all kanji.text → entry_id rows
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

    // 3. For each kanji character in each word, find the best (highest-numbered = easiest) JLPT level
    const charBest = new Map<string, number>();

    for (const row of kanjiRows) {
      const entry = entryMap.get(row.entry_id);
      if (!entry || !entry.common) continue;

      const seen = new Set<string>();
      for (const ch of row.text) {
        if (seen.has(ch)) continue;
        seen.add(ch);

        const code = ch.codePointAt(0)!;
        if (code < 0x4e00 || code > 0x9fff) continue;

        const current = charBest.get(ch);
        if (!current || entry.jlpt_level > current) {
          charBest.set(ch, entry.jlpt_level);
        }
      }
    }

    console.log(`  Derived JLPT levels for ${charBest.size} kanji characters`);

    // 4. Update jouyou kanji (grade 1-8) with derived levels
    const jouyou = db
      .prepare("SELECT literal FROM kanji_characters WHERE grade BETWEEN 1 AND 8")
      .all() as { literal: string }[];

    const updateStmt = db.prepare("UPDATE kanji_characters SET jlpt_level = ? WHERE literal = ?");

    // Load frequency ranks for fallback assignment
    const freqRows = db
      .prepare("SELECT literal, frequency_rank FROM kanji_characters WHERE grade BETWEEN 1 AND 8")
      .all() as { literal: string; frequency_rank: number | null }[];
    const freqMap = new Map<string, number | null>();
    for (const row of freqRows) {
      freqMap.set(row.literal, row.frequency_rank);
    }

    const applyAll = db.transaction(() => {
      let updated = 0;
      let fallback = 0;

      for (const { literal } of jouyou) {
        const derived = charBest.get(literal);
        if (derived != null) {
          updateStmt.run(derived, literal);
          updated++;
        } else {
          // Frequency-based fallback for jouyou kanji with no JLPT word match
          // freq ≤1000 → N3 (common, e.g. 藤/韓/昭), ≤1500 → N2, rest → N1
          const freq = freqMap.get(literal);
          const level = freq != null && freq <= 1000 ? 3 : freq != null && freq <= 1500 ? 2 : 1;
          updateStmt.run(level, literal);
          fallback++;
        }
      }

      // Clear jlpt_level for non-jouyou kanji (clean up bad old mappings)
      const nonJouyou = db
        .prepare(
          "UPDATE kanji_characters SET jlpt_level = NULL WHERE grade IS NULL OR grade NOT BETWEEN 1 AND 8",
        )
        .run();

      return { updated, fallback, nonJouyouCleared: nonJouyou.changes };
    });

    const { updated, fallback, nonJouyouCleared } = applyAll();
    console.log(`  ${updated} jouyou kanji updated with derived JLPT levels`);
    console.log(`  ${fallback} jouyou kanji assigned by frequency fallback`);
    console.log(`  ${nonJouyouCleared} non-jouyou kanji cleared`);
  },
};

export default migration;
