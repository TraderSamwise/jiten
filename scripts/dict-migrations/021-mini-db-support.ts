import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 21,
  description: "Bump version for mini DB support (no schema changes)",
  async migrate() {
    // No schema changes needed — the mini DB is a derived artifact
    // built from the full DB by the migration runner.
  },
};

export default migration;
