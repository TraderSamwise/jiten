import * as fs from "fs";
import * as path from "path";
import { downloadFile, CACHE_DIR } from "../lib/download";
import type { DictMigration } from "../migrate-dict";

const LESSONS_CSV_URL =
  "https://raw.githubusercontent.com/cyphar/heisig-rtk-index/refs/heads/master/LESSONS.csv";

const migration: DictMigration = {
  version: 14,
  description: "Add Heisig RTK lesson numbers to kanji",
  async migrate(db) {
    // Add column (skip if already exists)
    const cols = db.pragma("table_info(kanji_characters)") as { name: string }[];
    if (!cols.some((c) => c.name === "heisig_lesson")) {
      console.log("  Adding heisig_lesson column...");
      db.exec("ALTER TABLE kanji_characters ADD COLUMN heisig_lesson INTEGER");
    } else {
      console.log("  heisig_lesson column already exists, skipping ALTER");
    }

    // Download LESSONS.csv
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const csvPath = path.join(CACHE_DIR, "heisig-lessons.csv");
    await downloadFile(LESSONS_CSV_URL, csvPath);

    // Parse CSV: format is lesson_id,last_frame (56 rows)
    console.log("  Parsing Heisig lesson boundaries...");
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n");

    // Build lesson boundaries: lesson 1 starts at frame 1
    const lessons: { lesson: number; firstFrame: number; lastFrame: number }[] = [];
    let nextFirst = 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [lessonStr, lastFrameStr] = line.split(",");
      const lesson = parseInt(lessonStr, 10);
      const lastFrame = parseInt(lastFrameStr, 10);

      if (!Number.isFinite(lesson) || !Number.isFinite(lastFrame)) continue;

      lessons.push({ lesson, firstFrame: nextFirst, lastFrame });
      nextFirst = lastFrame + 1;
    }

    console.log(`  Found ${lessons.length} lessons`);

    // Update kanji_characters with lesson numbers
    const updateStmt = db.prepare(
      "UPDATE kanji_characters SET heisig_lesson = ? WHERE heisig_index >= ? AND heisig_index <= ?",
    );

    const applyAll = db.transaction(() => {
      let totalUpdated = 0;
      for (const { lesson, firstFrame, lastFrame } of lessons) {
        const result = updateStmt.run(lesson, firstFrame, lastFrame);
        totalUpdated += result.changes;
      }
      return totalUpdated;
    });

    const count = applyAll();
    console.log(`  ${count} kanji updated with lesson numbers`);

    // Create index
    db.exec("CREATE INDEX IF NOT EXISTS idx_kc_heisig_lesson ON kanji_characters(heisig_lesson)");
  },
};

export default migration;
