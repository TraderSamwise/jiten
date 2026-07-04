/**
 * Augment a dictionary-strokes.db with RTK primitive tables from
 * data/rtk-primitives.json.
 *
 * The primitive dataset is small and kanji-scoped, so it rides along in the
 * existing (small, kanji-focused) strokes download tier rather than a new tier
 * or the 120MB main dict. Idempotent: DROP+CREATE, safe to re-run.
 *
 * Usage: yarn build:strokes-primitives   (STROKES_DB overrides the target path)
 *
 * IMPORTANT: after running this, the strokes DB and dict-manifest.json must be
 * published together (strokes.version bumped) — never publish the manifest bump
 * without the rebuilt DB, or clients stamp the new version off the old file.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_PATH = path.join(PROJECT_ROOT, "data", "rtk-primitives.json");
const STROKES_DB =
  process.env.STROKES_DB || path.join(PROJECT_ROOT, "assets", "dictionary-strokes.db");

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Missing ${DATA_PATH} — run \`yarn build:rtk\` first.`);
  process.exit(1);
}
if (!fs.existsSync(STROKES_DB)) {
  console.error(`Strokes DB not found at: ${STROKES_DB}\nSet STROKES_DB to override.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const sqlStr = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sqlNum = (n) => (n == null ? "NULL" : String(n));
const sqlBool = (b) => (b ? 1 : 0);

const stmts = [
  "PRAGMA foreign_keys=OFF;",
  "BEGIN;",
  "DROP TABLE IF EXISTS kanji_primitives;",
  "DROP TABLE IF EXISTS primitives;",
  `CREATE TABLE kanji_primitives (
     literal TEXT NOT NULL,
     position INTEGER NOT NULL,
     glyph TEXT,
     primitive_id INTEGER,
     keyword TEXT,
     is_primitive INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE TABLE primitives (
     id INTEGER PRIMARY KEY,
     keyword TEXT,
     display_glyph TEXT,
     real_glyph TEXT,
     strokes INTEGER
   );`,
];

const kpRows = [];
for (const [literal, k] of Object.entries(data.kanji)) {
  (k.primitives || []).forEach((p, i) => {
    kpRows.push(
      `(${sqlStr(literal)},${i},${sqlStr(p.glyph)},${sqlNum(p.primitiveId)},${sqlStr(p.keyword)},${sqlBool(p.isPrimitive)})`,
    );
  });
}
const prRows = [];
for (const [id, p] of Object.entries(data.primitives)) {
  prRows.push(
    `(${sqlNum(id)},${sqlStr(p.keyword)},${sqlStr(p.displayGlyph)},${sqlStr(p.realGlyph)},${sqlNum(p.strokes)})`,
  );
}

// Chunk multi-row INSERTs to keep statements a reasonable size.
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
for (const c of chunk(kpRows, 500)) {
  stmts.push(
    `INSERT INTO kanji_primitives (literal, position, glyph, primitive_id, keyword, is_primitive) VALUES\n${c.join(",\n")};`,
  );
}
for (const c of chunk(prRows, 500)) {
  stmts.push(
    `INSERT INTO primitives (id, keyword, display_glyph, real_glyph, strokes) VALUES\n${c.join(",\n")};`,
  );
}
stmts.push("CREATE INDEX idx_kp_literal ON kanji_primitives(literal);");
stmts.push("CREATE INDEX idx_kp_primitive_id ON kanji_primitives(primitive_id);");
stmts.push("COMMIT;");
stmts.push("VACUUM;"); // compact after augmentation so callers ship a tight DB

try {
  execFileSync("sqlite3", [STROKES_DB], { input: stmts.join("\n"), maxBuffer: 256 * 1024 * 1024 });
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("`sqlite3` CLI not found on PATH — install it to run this build step.");
    process.exit(1);
  }
  throw err;
}

// ── Validation ──
const check = execFileSync(
  "sqlite3",
  [
    "-json",
    "-readonly",
    STROKES_DB,
    "SELECT keyword FROM kanji_primitives WHERE literal='宣' ORDER BY position",
  ],
  { encoding: "utf8" },
).trim();
const sen = check
  ? JSON.parse(check)
      .map((r) => r.keyword)
      .join(",")
  : "";
if (sen !== "house,span") {
  console.error(`VALIDATION FAILED: 宣 primitives = "${sen}" (expected house,span)`);
  process.exit(1);
}

// Round-trip a keyword containing an apostrophe to exercise quote-escaping.
const aposEntry = Object.entries(data.primitives).find(([, p]) => (p.keyword || "").includes("'"));
if (aposEntry) {
  const [aid, ap] = aposEntry;
  const raw = execFileSync(
    "sqlite3",
    ["-json", "-readonly", STROKES_DB, `SELECT keyword FROM primitives WHERE id=${Number(aid)}`],
    { encoding: "utf8" },
  ).trim();
  const got = raw ? JSON.parse(raw)[0]?.keyword : null;
  if (got !== ap.keyword) {
    console.error(
      `VALIDATION FAILED: primitive ${aid} keyword = ${JSON.stringify(got)} (expected ${JSON.stringify(ap.keyword)})`,
    );
    process.exit(1);
  }
}

console.log(
  `Augmented ${path.basename(STROKES_DB)}: ${kpRows.length} component rows, ${prRows.length} primitives\n  宣 -> ${sen}`,
);
