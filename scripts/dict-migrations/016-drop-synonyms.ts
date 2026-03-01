import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 16,
  description: "Remove synonyms table (moved to extended data download)",
  async migrate(db) {
    db.exec("DROP TABLE IF EXISTS synonyms");
    db.exec("DROP INDEX IF EXISTS idx_synonyms_word");
    db.exec("DROP INDEX IF EXISTS idx_synonyms_synonym");
    console.log("  Dropped synonyms table and indexes");
  },
};

export default migration;
