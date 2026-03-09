import type Database from "better-sqlite3";
import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 20,
  description: "Drop similarity_vector column and NULL out stroke_paths (deferred to separate DB)",
  async migrate(db) {
    // SQLite doesn't support DROP COLUMN before 3.35.0, and better-sqlite3
    // bundles its own SQLite. Use the safe approach: rebuild the table.

    // 1. Create new table without similarity_vector
    db.exec(`
      CREATE TABLE kanji_characters_new (
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
        heisig_keyword TEXT,
        heisig_lesson INTEGER
      )
    `);

    // 2. Copy data, setting stroke_paths to NULL (strokes now in separate DB)
    db.exec(`
      INSERT INTO kanji_characters_new (
        literal, grade, stroke_count, frequency_rank, jlpt_old, jlpt_level,
        readings_on, readings_kun, meanings, nanori, radical_classical,
        radical_nelson, heisig_index, unicode_codepoint, stroke_paths,
        heisig_keyword, heisig_lesson
      )
      SELECT
        literal, grade, stroke_count, frequency_rank, jlpt_old, jlpt_level,
        readings_on, readings_kun, meanings, nanori, radical_classical,
        radical_nelson, heisig_index, unicode_codepoint, NULL,
        heisig_keyword, heisig_lesson
      FROM kanji_characters
    `);

    const count = db.prepare("SELECT count(*) as cnt FROM kanji_characters_new").get() as {
      cnt: number;
    };
    console.log(`  ${count.cnt} kanji characters migrated`);

    // 3. Swap tables
    db.exec(`DROP TABLE kanji_characters`);
    db.exec(`ALTER TABLE kanji_characters_new RENAME TO kanji_characters`);

    // 4. Recreate indexes
    db.exec(`
      CREATE INDEX idx_kc_grade ON kanji_characters(grade);
      CREATE INDEX idx_kc_jlpt ON kanji_characters(jlpt_level);
      CREATE INDEX idx_kc_frequency ON kanji_characters(frequency_rank);
      CREATE INDEX idx_kc_stroke_count ON kanji_characters(stroke_count);
      CREATE INDEX idx_kc_radical ON kanji_characters(radical_classical);
      CREATE INDEX idx_kc_heisig ON kanji_characters(heisig_index);
    `);
  },
};

export default migration;
