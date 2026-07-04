/**
 * Build a compact keyword -> synonym map for RTK keywords into the strokes tier.
 *
 * The semantic auto-linker matches a user's story words against a kanji's
 * primitive keywords. Story words are the user's own wording ("home" for the
 * "house" primitive), so we precompute WordNet synonyms for every RTK keyword
 * and ship them alongside the primitives in the small strokes DB — auto-linking
 * then works offline without the 117MB extended tier.
 *
 * Synonyms are intentionally BROAD (any common English word a user might write),
 * so — unlike scripts/build-extended-data.ts insertSynonyms — there is NO
 * gloss-vocabulary filter and no dictionary.db dependency. Only single-word,
 * length>=3, non-self synonyms are kept.
 *
 * Idempotent: DROP+CREATE, safe to re-run.
 * Usage: yarn build:keyword-synonyms   (STROKES_DB overrides the target path)
 *
 * IMPORTANT: like the primitive tables, the rebuilt strokes DB and
 * dict-manifest.json (strokes.version) must be published together.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import WordNet from "node-wordnet";
import wordnetDb from "wordnet-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_PATH = path.join(PROJECT_ROOT, "data", "rtk-primitives.json");
const STROKES_DB =
  process.env.STROKES_DB || path.join(PROJECT_ROOT, "assets", "dictionary-strokes.db");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

// Collect every distinct keyword (kanji keywords + primitive keywords), lowercased.
const keywords = new Set();
for (const k of Object.values(data.kanji)) {
  if (k.keyword) keywords.add(k.keyword.toLowerCase());
}
for (const p of Object.values(data.primitives)) {
  if (p.keyword) keywords.add(p.keyword.toLowerCase());
}

const RELATED_PTRS = new Set(["+", "&", "~"]); // derivational, similar-to, hyponym

function keep(normalized, self) {
  return !normalized.includes(" ") && normalized.length >= 3 && normalized !== self;
}

async function synonymsFor(wn, keyword) {
  // WordNet keys on single words; multi-word keywords ("pack of wild dogs")
  // return nothing and are matched exactly by the resolver instead.
  if (keyword.includes(" ")) return [];
  const found = new Set();
  let results;
  try {
    results = await wn.lookupAsync(keyword);
  } catch {
    return [];
  }
  for (const result of results) {
    for (const syn of result.synonyms) {
      const n = syn.toLowerCase().replace(/_/g, " ");
      if (keep(n, keyword)) found.add(n);
    }
    for (const ptr of result.ptrs) {
      if (!RELATED_PTRS.has(ptr.pointerSymbol)) continue;
      try {
        const related = await wn.getAsync(ptr.synsetOffset, ptr.pos);
        for (const syn of related.synonyms) {
          const n = syn.toLowerCase().replace(/_/g, " ");
          if (keep(n, keyword)) found.add(n);
        }
      } catch {}
    }
  }
  return [...found];
}

async function main() {
  const wn = new WordNet(wordnetDb.path);
  const keywordArray = [...keywords];
  const pairs = [];

  const BATCH_SIZE = 300;
  for (let i = 0; i < keywordArray.length; i += BATCH_SIZE) {
    const batch = keywordArray.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (kw) => {
        for (const syn of await synonymsFor(wn, kw)) pairs.push([kw, syn]);
      }),
    );
  }

  const db = new Database(STROKES_DB);
  db.exec(`
    DROP TABLE IF EXISTS keyword_synonyms;
    CREATE TABLE keyword_synonyms (
      keyword TEXT NOT NULL,
      synonym TEXT NOT NULL
    );
    CREATE INDEX idx_ks_keyword ON keyword_synonyms(keyword);
    CREATE INDEX idx_ks_synonym ON keyword_synonyms(synonym);
  `);
  const insert = db.prepare("INSERT INTO keyword_synonyms (keyword, synonym) VALUES (?, ?)");
  const insertAll = db.transaction((rows) => {
    for (const [kw, syn] of rows) insert.run(kw, syn);
  });
  insertAll(pairs);
  db.exec("VACUUM");
  db.close();

  console.log(
    `Augmented ${path.basename(STROKES_DB)}: ${pairs.length} keyword-synonym pairs ` +
      `for ${keywordArray.length} keywords`,
  );
}

main().catch((err) => {
  console.error("build-keyword-synonyms failed:", err);
  process.exit(1);
});
