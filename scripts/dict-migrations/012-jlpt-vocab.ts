import type Database from "better-sqlite3";
import { downloadJlptCsvs, loadJlptVocab } from "../lib/jlpt";
import { CACHE_DIR } from "../lib/download";
import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 12,
  description: "Add JLPT vocab levels to entries",
  async migrate(db) {
    // Add column (skip if already exists)
    const cols = db.pragma("table_info(entries)") as { name: string }[];
    if (!cols.some((c) => c.name === "jlpt_level")) {
      db.exec("ALTER TABLE entries ADD COLUMN jlpt_level INTEGER");
    }

    // Download and parse JLPT data
    await downloadJlptCsvs();
    const jlptVocabMap = loadJlptVocab(CACHE_DIR);
    console.log(`  ${jlptVocabMap.size} JLPT vocab entries parsed from CSVs`);

    // Update entries
    const updateStmt = db.prepare("UPDATE entries SET jlpt_level = ? WHERE id = ?");
    const applyAll = db.transaction(() => {
      let updated = 0;
      for (const [seq, level] of jlptVocabMap) {
        const result = updateStmt.run(level, seq);
        if (result.changes > 0) updated++;
      }
      return updated;
    });
    const count = applyAll();
    console.log(`  ${count} entries updated with JLPT levels`);

    // Create index (skip if exists)
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_jlpt ON entries(jlpt_level)");
  },
};

export default migration;
