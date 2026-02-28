import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";
import { buildKanjiTables } from "../kanji/build-kanji-tables";
import { downloadFile, CACHE_DIR } from "../lib/download";
import { parseCsvLine } from "../lib/jlpt";
import type { DictMigration } from "../migrate-dict";

const HEISIG_CSV_URL =
  "https://raw.githubusercontent.com/sdcr/heisig-kanjis/master/heisig-kanjis.csv";

const migration: DictMigration = {
  version: 13,
  description: "Build kanji tables and add Heisig keywords",
  async migrate(db) {
    // ─── Part A: Build kanji tables (if not already present) ───

    const kanjiTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kanji_characters'")
      .get();

    if (!kanjiTableExists) {
      console.log("  Building kanji tables...");
      await buildKanjiTables(db);
    } else {
      console.log("  Kanji tables already exist, skipping build");
    }

    // ─── Part B: Add Heisig keywords ───

    // Add column (skip if already exists)
    const cols = db.pragma("table_info(kanji_characters)") as { name: string }[];
    if (!cols.some((c) => c.name === "heisig_keyword")) {
      console.log("  Adding heisig_keyword column...");
      db.exec("ALTER TABLE kanji_characters ADD COLUMN heisig_keyword TEXT");
    } else {
      console.log("  heisig_keyword column already exists, skipping ALTER");
    }

    // Download Heisig CSV
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const csvPath = path.join(CACHE_DIR, "heisig-kanjis.csv");
    await downloadFile(HEISIG_CSV_URL, csvPath);

    // Parse CSV and update kanji_characters
    console.log("  Parsing Heisig keywords...");
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n");
    const header = parseCsvLine(lines[0] ?? "");

    const kanjiIdx = header.indexOf("kanji");
    const keyword6thIdx = header.indexOf("keyword_6th_ed");

    if (kanjiIdx === -1 || keyword6thIdx === -1) {
      throw new Error(`Heisig CSV missing expected columns. Found: ${header.join(", ")}`);
    }

    const updateStmt = db.prepare(
      "UPDATE kanji_characters SET heisig_keyword = ? WHERE literal = ?",
    );

    const applyAll = db.transaction(() => {
      let updated = 0;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = parseCsvLine(line);
        const kanji = fields[kanjiIdx];
        const keyword = fields[keyword6thIdx];

        if (!kanji || !keyword) continue;

        const result = updateStmt.run(keyword, kanji);
        if (result.changes > 0) updated++;
      }
      return updated;
    });

    const count = applyAll();
    console.log(`  ${count} kanji updated with Heisig keywords`);

    // Create index on heisig_keyword
    db.exec("CREATE INDEX IF NOT EXISTS idx_kc_heisig_keyword ON kanji_characters(heisig_keyword)");
  },
};

export default migration;
