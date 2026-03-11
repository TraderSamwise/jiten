import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { DictMigration } from "../migrate-dict";

const CSV_PATH = path.resolve(__dirname, "../../data/jlpt-words.csv");

const migration: DictMigration = {
  version: 22,
  description: "Update JLPT levels from audited word list (2-step audit round)",
  async migrate(db) {
    // --- Part 1: Update entries.jlpt_level from CSV ---

    const csv = fs.readFileSync(CSV_PATH, "utf-8");
    const lines = csv.trim().split("\n").slice(1); // skip header

    // Clear all existing JLPT levels first (we're replacing, not patching)
    db.exec("UPDATE entries SET jlpt_level = NULL");

    const updateEntry = db.prepare("UPDATE entries SET jlpt_level = ? WHERE id = ?");
    const applyEntries = db.transaction(() => {
      let updated = 0;
      for (const line of lines) {
        const firstComma = line.indexOf(",");
        const id = parseInt(line.slice(0, firstComma), 10);
        const parts = line.split(",");
        const jlptLevel = parseInt(parts[parts.length - 3], 10);
        if (isNaN(id) || isNaN(jlptLevel)) continue;
        const result = updateEntry.run(jlptLevel, id);
        if (result.changes > 0) updated++;
      }
      return updated;
    });

    const entryCount = applyEntries();
    console.log(`  ${entryCount} entries updated with audited JLPT levels`);

    // --- Part 2: Re-derive kanji JLPT levels ---

    const kanjiRows = db.prepare("SELECT text, entry_id FROM kanji").all() as {
      text: string;
      entry_id: number;
    }[];

    const entryRows = db
      .prepare("SELECT id, jlpt_level, common FROM entries WHERE jlpt_level IS NOT NULL")
      .all() as { id: number; jlpt_level: number; common: number }[];

    const entryMap = new Map<number, { jlpt_level: number; common: number }>();
    for (const row of entryRows) {
      entryMap.set(row.id, { jlpt_level: row.jlpt_level, common: row.common });
    }

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

    const jouyou = db
      .prepare("SELECT literal FROM kanji_characters WHERE grade BETWEEN 1 AND 8")
      .all() as { literal: string }[];

    const updateKanji = db.prepare("UPDATE kanji_characters SET jlpt_level = ? WHERE literal = ?");

    const freqRows = db
      .prepare("SELECT literal, frequency_rank FROM kanji_characters WHERE grade BETWEEN 1 AND 8")
      .all() as { literal: string; frequency_rank: number | null }[];
    const freqMap = new Map<string, number | null>();
    for (const row of freqRows) {
      freqMap.set(row.literal, row.frequency_rank);
    }

    const applyKanji = db.transaction(() => {
      let updated = 0;
      let fallback = 0;

      for (const { literal } of jouyou) {
        const derived = charBest.get(literal);
        if (derived != null) {
          updateKanji.run(derived, literal);
          updated++;
        } else {
          const freq = freqMap.get(literal);
          const level = freq != null && freq <= 1000 ? 3 : freq != null && freq <= 1500 ? 2 : 1;
          updateKanji.run(level, literal);
          fallback++;
        }
      }

      const nonJouyou = db
        .prepare(
          "UPDATE kanji_characters SET jlpt_level = NULL WHERE grade IS NULL OR grade NOT BETWEEN 1 AND 8",
        )
        .run();

      return { updated, fallback, nonJouyouCleared: nonJouyou.changes };
    });

    const { updated, fallback, nonJouyouCleared } = applyKanji();
    console.log(`  ${updated} jouyou kanji updated with derived JLPT levels`);
    console.log(`  ${fallback} jouyou kanji assigned by frequency fallback`);
    console.log(`  ${nonJouyouCleared} non-jouyou kanji cleared`);
  },
};

export default migration;
