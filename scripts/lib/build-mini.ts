/**
 * Builds dictionary-mini.db from the full dictionary.db.
 * Contains only common entries (~22k) + all kanji tables.
 *
 * Used by both build-dictionary.ts (full rebuild) and migrate-dict.ts (incremental).
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

export interface MiniBuildResult {
  sizeBytes: number;
  compressedSizeBytes: number;
  entryCount: number;
}

export function buildMiniDb(fullDbPath: string, miniDbPath: string): MiniBuildResult {
  console.log("\nBuilding mini dictionary...");
  if (fs.existsSync(miniDbPath)) fs.unlinkSync(miniDbPath);

  const miniDb = new Database(miniDbPath);
  miniDb.pragma("journal_mode = WAL");

  // Create identical schema to full DB (minus word_audio which is split out)
  miniDb.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      common INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      jlpt_level INTEGER
    );

    CREATE TABLE kanji (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      text TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );

    CREATE TABLE kana (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      text TEXT NOT NULL,
      romaji TEXT,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );

    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      part_of_speech TEXT,
      glosses TEXT NOT NULL,
      field TEXT,
      misc TEXT,
      info TEXT
    );

    CREATE TABLE pitch_accents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      reading TEXT NOT NULL,
      pitch_number INTEGER NOT NULL
    );
  `);

  // ATTACH the full DB and copy common entries + kanji tables
  miniDb.exec(`ATTACH DATABASE '${fullDbPath}' AS source`);

  // Copy common entries and their associated data
  miniDb.exec(`INSERT INTO entries SELECT * FROM source.entries WHERE common = 1`);
  miniDb.exec(
    `INSERT INTO kanji SELECT * FROM source.kanji WHERE entry_id IN (SELECT id FROM entries)`,
  );
  miniDb.exec(
    `INSERT INTO kana SELECT * FROM source.kana WHERE entry_id IN (SELECT id FROM entries)`,
  );
  miniDb.exec(
    `INSERT INTO senses SELECT * FROM source.senses WHERE entry_id IN (SELECT id FROM entries)`,
  );
  miniDb.exec(
    `INSERT INTO pitch_accents SELECT * FROM source.pitch_accents WHERE entry_id IN (SELECT id FROM entries)`,
  );

  const miniEntryCount = miniDb.prepare("SELECT count(*) as cnt FROM entries").get() as {
    cnt: number;
  };
  console.log(`  ${miniEntryCount.cnt} common entries copied`);

  // Create indexes on entry tables
  miniDb.exec(`
    CREATE INDEX idx_kanji_entry ON kanji(entry_id);
    CREATE INDEX idx_kanji_text ON kanji(text);
    CREATE INDEX idx_kana_entry ON kana(entry_id);
    CREATE INDEX idx_kana_text ON kana(text);
    CREATE INDEX idx_kana_romaji ON kana(romaji);
    CREATE INDEX idx_senses_entry ON senses(entry_id);
    CREATE INDEX idx_pitch_entry ON pitch_accents(entry_id);
    CREATE INDEX idx_entries_common ON entries(common);
    CREATE INDEX idx_entries_priority ON entries(priority);
    CREATE INDEX idx_entries_jlpt ON entries(jlpt_level);
  `);

  // Build FTS index from mini data only
  miniDb.exec(`
    CREATE VIRTUAL TABLE glosses_fts USING fts5(
      glosses,
      entry_id UNINDEXED,
      tokenize='porter unicode61'
    );

    INSERT INTO glosses_fts (glosses, entry_id)
    SELECT
      GROUP_CONCAT(json_extract(j.value, '$.text'), ' '),
      s.entry_id
    FROM senses s, json_each(s.glosses) j
    WHERE json_extract(j.value, '$.lang') = 'eng'
    GROUP BY s.entry_id;
  `);

  // Copy ALL kanji tables verbatim (standalone, not entry-dependent).
  // Use explicit column lists so this works regardless of whether the source DB
  // has old columns (e.g. similarity_vector) that we no longer need.
  const KANJI_COLS = [
    "literal",
    "grade",
    "stroke_count",
    "frequency_rank",
    "jlpt_old",
    "jlpt_level",
    "readings_on",
    "readings_kun",
    "meanings",
    "nanori",
    "radical_classical",
    "radical_nelson",
    "heisig_index",
    "unicode_codepoint",
    "stroke_paths",
    "heisig_keyword",
    "heisig_lesson",
  ];

  // Detect which columns actually exist in the source DB
  const sourceColsRaw = miniDb.prepare("PRAGMA source.table_info(kanji_characters)").all() as {
    name: string;
  }[];
  const sourceCols = new Set(sourceColsRaw.map((c) => c.name));
  const availableCols = KANJI_COLS.filter((c) => sourceCols.has(c));
  const colList = availableCols.join(", ");
  // For missing columns, use NULL
  const selectExprs = KANJI_COLS.map((c) => (sourceCols.has(c) ? c : `NULL AS ${c}`)).join(", ");

  miniDb.exec(`
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
      heisig_keyword TEXT,
      heisig_lesson INTEGER
    );

    CREATE TABLE kanji_radicals (
      literal TEXT NOT NULL,
      radical TEXT NOT NULL,
      PRIMARY KEY (literal, radical)
    );

    CREATE TABLE kanji_similarity (
      literal TEXT NOT NULL,
      similar TEXT NOT NULL,
      score REAL NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY (literal, similar)
    );
  `);

  miniDb.exec(
    `INSERT INTO kanji_characters (${KANJI_COLS.join(", ")}) SELECT ${selectExprs} FROM source.kanji_characters`,
  );
  miniDb.exec(`INSERT INTO kanji_radicals SELECT * FROM source.kanji_radicals`);
  miniDb.exec(`INSERT INTO kanji_similarity SELECT * FROM source.kanji_similarity`);

  // Create kanji indexes
  miniDb.exec(`
    CREATE INDEX idx_kc_grade ON kanji_characters(grade);
    CREATE INDEX idx_kc_jlpt ON kanji_characters(jlpt_level);
    CREATE INDEX idx_kc_frequency ON kanji_characters(frequency_rank);
    CREATE INDEX idx_kc_stroke_count ON kanji_characters(stroke_count);
    CREATE INDEX idx_kc_radical ON kanji_characters(radical_classical);
    CREATE INDEX idx_kc_heisig ON kanji_characters(heisig_index);
    CREATE INDEX idx_kr_radical ON kanji_radicals(radical);
    CREATE INDEX idx_ks_literal_rank ON kanji_similarity(literal, rank);
  `);

  // Rebuild kanji_meanings_fts (FTS5 virtual tables can't be copied via ATTACH)
  miniDb.exec(`
    CREATE VIRTUAL TABLE kanji_meanings_fts USING fts5(
      meanings, literal UNINDEXED,
      tokenize='porter unicode61'
    );

    INSERT INTO kanji_meanings_fts (meanings, literal)
    SELECT meanings, literal
    FROM kanji_characters
    WHERE meanings IS NOT NULL;
  `);

  // Copy dict_meta
  miniDb.exec(`CREATE TABLE IF NOT EXISTS dict_meta (key TEXT PRIMARY KEY, value TEXT)`);
  miniDb.exec(`INSERT INTO dict_meta SELECT * FROM source.dict_meta`);

  miniDb.exec(`DETACH source`);

  // Optimize
  miniDb.exec("PRAGMA optimize");
  miniDb.exec("VACUUM");
  miniDb.close();

  const miniStats = fs.statSync(miniDbPath);
  console.log(`  Mini DB: ${(miniStats.size / 1024 / 1024).toFixed(1)} MB`);

  const { execSync } = require("child_process");
  const compressedSize = parseInt(
    execSync(`gzip -c "${miniDbPath}" | wc -c`).toString().trim(),
    10,
  );
  console.log(`  Mini DB compressed: ${(compressedSize / 1024 / 1024).toFixed(1)} MB`);

  return {
    sizeBytes: miniStats.size,
    compressedSizeBytes: compressedSize,
    entryCount: miniEntryCount.cnt,
  };
}
