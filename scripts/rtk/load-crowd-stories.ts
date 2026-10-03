/**
 * Load the crowd's best RTK story per frame into the quota database, where the
 * mnemonic endpoint reads it as grounding.
 *
 * Usage: yarn load:crowd-stories
 *   TURSO_QUOTA_DB_URL / TURSO_QUOTA_DB_TOKEN must be set (same database the
 *   AI usage counters use).
 *
 * The corpus is NOT committed and never reaches a device: it is unlicensed
 * user-generated text, and two of the source file's columns are Heisig's own
 * book text, which `parse-crowd-stories.ts` drops. Only the best-voted learner
 * story per frame is stored, and only the model ever reads it.
 */
import { createClient } from "@libsql/client";

import { parseCrowdStories } from "./parse-crowd-stories";

const CSV_URL =
  "https://raw.githubusercontent.com/Arthur944/remembering-the-kanji-stories/master/final.csv";
const TABLE = "rtk_crowd_story";
const CHUNK = 200;

async function main(): Promise<void> {
  const url = process.env.TURSO_QUOTA_DB_URL;
  const authToken = process.env.TURSO_QUOTA_DB_TOKEN;
  if (!url || !authToken) {
    console.error("❌ TURSO_QUOTA_DB_URL and TURSO_QUOTA_DB_TOKEN must be set.");
    process.exit(1);
  }

  console.log(`Downloading ${CSV_URL}`);
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    console.error(`❌ Download failed: ${res.status}`);
    process.exit(1);
  }
  const rows = parseCrowdStories(await res.text());
  console.log(`Parsed ${rows.length} frames with at least one story`);

  const db = createClient({ url, authToken });
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       literal TEXT PRIMARY KEY,
       story TEXT NOT NULL,
       votes INTEGER NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );

  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map((row) => ({
        sql: `INSERT INTO ${TABLE} (literal, story, votes, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(literal) DO UPDATE SET story = excluded.story, votes = excluded.votes, updated_at = excluded.updated_at`,
        args: [row.literal, row.stories[0].text, row.stories[0].votes, now],
      })),
      "write",
    );
    console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  const count = await db.execute(`SELECT COUNT(*) AS n FROM ${TABLE}`);
  console.log(`✅ ${TABLE} holds ${count.rows[0].n} frames`);
}

main().catch((err) => {
  console.error("Load failed:", err);
  process.exit(1);
});
