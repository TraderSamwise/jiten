import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 23,
  description: "Version bump to force re-download (fix stale full DB on v22 upgrade)",
  async migrate() {
    // No data changes — the v22 data is correct.
    // This bump forces users with a stale dictionary-full.db to re-download.
  },
};

export default migration;
