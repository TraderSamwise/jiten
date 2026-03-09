/**
 * Dictionary migration runner: applies incremental schema/data changes
 * to the existing assets/dictionary.db without a full rebuild.
 *
 * Usage: yarn migrate:dict
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { DICT_VERSION } from "../db/dict-version";
import { ASSETS_DIR } from "./lib/download";
import { buildMiniDb } from "./lib/build-mini";

const DB_PATH = path.join(ASSETS_DIR, "dictionary.db");
const MINI_DB_PATH = path.join(ASSETS_DIR, "dictionary-mini.db");
const MANIFEST_PATH = path.join(ASSETS_DIR, "dict-manifest.json");

export interface DictMigration {
  version: number;
  description: string;
  migrate(db: Database.Database): Promise<void>;
}

/** Load all migration files from dict-migrations/, sorted by version. */
async function loadMigrations(): Promise<DictMigration[]> {
  const migrationsDir = path.join(__dirname, "dict-migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort();

  const migrations: DictMigration[] = [];
  for (const file of files) {
    const mod = await import(path.join(migrationsDir, file));
    const migration: DictMigration = mod.default;
    if (!migration?.version || !migration?.migrate) {
      console.warn(`  Skipping ${file}: invalid migration format`);
      continue;
    }
    migrations.push(migration);
  }
  return migrations.sort((a, b) => a.version - b.version);
}

/** Detect current dict version from dict_meta table or schema inspection. */
function detectVersion(db: Database.Database): number {
  // Check for dict_meta table first
  const metaTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dict_meta'")
    .get();
  if (metaTable) {
    const row = db.prepare("SELECT value FROM dict_meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;
    if (row) return parseInt(row.value, 10);
  }

  // Infer from schema: if jlpt_level exists on entries, it's at least v12
  const cols = db.pragma("table_info(entries)") as { name: string }[];
  if (cols.some((c) => c.name === "jlpt_level")) return 12;

  // Default: v11 (last version before migration system)
  return 11;
}

/** Ensure dict_meta table exists and set version. */
function setVersion(db: Database.Database, version: number): void {
  db.exec("CREATE TABLE IF NOT EXISTS dict_meta (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT OR REPLACE INTO dict_meta (key, value) VALUES ('version', ?)").run(
    String(version),
  );
}

/** Rebuild mini DB and update manifest.json with new version and sizes. */
function updateManifestAndMini(version: number): void {
  const stats = fs.statSync(DB_PATH);

  // Rebuild mini DB from the migrated full DB
  const miniResult = buildMiniDb(DB_PATH, MINI_DB_PATH);

  // Compute compressed size of full DB
  const { execSync } = require("child_process");
  const compressedSize = parseInt(execSync(`gzip -c "${DB_PATH}" | wc -c`).toString().trim(), 10);

  let manifest: Record<string, unknown> = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  }
  manifest.version = version;
  manifest.sizeBytes = stats.size;
  manifest.compressedSizeBytes = compressedSize;
  manifest.miniSizeBytes = miniResult.sizeBytes;
  manifest.miniCompressedSizeBytes = miniResult.compressedSizeBytes;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ No dictionary.db found at ${DB_PATH}`);
    console.error("   A base dictionary must exist before running migrations.");
    console.error("   Run 'yarn build:db' for a full build first.");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const currentVersion = detectVersion(db);
  console.log(`Current dictionary version: ${currentVersion}`);
  console.log(`Target version: ${DICT_VERSION}`);

  // Ensure dict_meta table exists with current version
  setVersion(db, currentVersion);

  if (currentVersion >= DICT_VERSION) {
    console.log("\n✅ Already up to date.");
    db.close();
    updateManifestAndMini(DICT_VERSION);
    return;
  }

  const migrations = await loadMigrations();
  const pending = migrations.filter((m) => m.version > currentVersion && m.version <= DICT_VERSION);

  if (pending.length === 0) {
    console.log("\n⚠️  No migration files found for pending versions.");
    db.close();
    return;
  }

  console.log(`\nApplying ${pending.length} migration(s):\n`);

  for (const migration of pending) {
    console.log(`→ v${migration.version}: ${migration.description}`);
    await migration.migrate(db);
    setVersion(db, migration.version);
    console.log(`  ✓ Applied v${migration.version}\n`);
  }

  db.exec("PRAGMA optimize");
  console.log("Vacuuming...");
  db.exec("VACUUM");
  db.close();

  updateManifestAndMini(DICT_VERSION);
  console.log(`✅ Dictionary migrated to v${DICT_VERSION}`);
  console.log(`   Manifest updated at ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
