/**
 * Build script: Generates extended data files (synonyms + names) as compressed JSONL.
 *
 * These are downloaded in the background by the app and inserted progressively
 * into a local dictionary-extended.db.
 *
 * Usage: npx tsx scripts/build-extended-data.ts
 *
 * Output:
 *   assets/synonyms.jsonl.gz
 *   assets/names.jsonl.gz
 *   (updates assets/dict-manifest.json with extended data section)
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import Database from "better-sqlite3";
import WordNet from "node-wordnet";
import wordnetDb from "wordnet-db";
import { downloadFile, CACHE_DIR, ASSETS_DIR } from "./lib/download";

const DB_PATH = path.join(ASSETS_DIR, "dictionary.db");
const MANIFEST_PATH = path.join(ASSETS_DIR, "dict-manifest.json");

// ─── Synonyms ───

async function buildSynonyms(): Promise<{ filePath: string; rowCount: number }> {
  console.log("\n=== Building synonyms.jsonl.gz ===\n");

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`dictionary.db not found at ${DB_PATH}. Run yarn migrate:dict first.`);
  }

  const db = new Database(DB_PATH, { readonly: true });

  // Extract gloss vocabulary — all unique content words from English glosses
  console.log("  Extracting gloss vocabulary...");
  const glossRows = db.prepare(`SELECT glosses FROM senses`).all() as { glosses: string }[];

  const glossVocab = new Set<string>();
  const wordPattern = /[a-z]{3,}/g;
  for (const row of glossRows) {
    try {
      const glosses = JSON.parse(row.glosses) as { lang: string; text: string }[];
      for (const g of glosses) {
        if (g.lang !== "eng") continue;
        const words = g.text.toLowerCase().match(wordPattern);
        if (words) {
          for (const w of words) glossVocab.add(w);
        }
      }
    } catch {}
  }
  db.close();
  console.log(`  ${glossVocab.size} unique vocabulary words`);

  // Look up WordNet relationships
  console.log("  Looking up WordNet relationships...");
  const wn = new WordNet(wordnetDb.path);
  const RELATED_PTRS = new Set(["+", "&", "~"]); // derivational, similar-to, hyponym
  const lines: string[] = [];
  let wordsDone = 0;
  const vocabArray = [...glossVocab];

  const BATCH_SIZE = 500;
  for (let i = 0; i < vocabArray.length; i += BATCH_SIZE) {
    const batch = vocabArray.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (word) => {
        try {
          const results = await wn.lookupAsync(word);
          const synonyms = new Set<string>();

          for (const result of results) {
            for (const syn of result.synonyms) {
              const normalized = syn.toLowerCase().replace(/_/g, " ");
              if (
                !normalized.includes(" ") &&
                normalized.length >= 3 &&
                glossVocab.has(normalized) &&
                normalized !== word
              ) {
                synonyms.add(normalized);
              }
            }

            for (const ptr of result.ptrs) {
              if (!RELATED_PTRS.has(ptr.pointerSymbol)) continue;
              try {
                const related = await wn.getAsync(ptr.synsetOffset, ptr.pos);
                for (const syn of related.synonyms) {
                  const normalized = syn.toLowerCase().replace(/_/g, " ");
                  if (
                    !normalized.includes(" ") &&
                    normalized.length >= 3 &&
                    glossVocab.has(normalized) &&
                    normalized !== word
                  ) {
                    synonyms.add(normalized);
                  }
                }
              } catch {}
            }
          }

          for (const syn of synonyms) {
            lines.push(JSON.stringify({ w: word, s: syn }));
          }
        } catch {}
      }),
    );

    wordsDone += batch.length;
    if (wordsDone % 5000 === 0 || wordsDone === vocabArray.length) {
      console.log(`  ${wordsDone}/${vocabArray.length} words processed, ${lines.length} pairs...`);
    }
  }

  console.log(`  ${lines.length} synonym pairs total`);

  // Write compressed JSONL
  const outPath = path.join(ASSETS_DIR, "synonyms.jsonl.gz");
  const jsonl = lines.join("\n") + "\n";
  const compressed = zlib.gzipSync(Buffer.from(jsonl));
  fs.writeFileSync(outPath, compressed);
  console.log(
    `  Written: ${outPath} (${(compressed.length / 1024).toFixed(0)} KB compressed, ${(jsonl.length / 1024).toFixed(0)} KB uncompressed)`,
  );

  return { filePath: outPath, rowCount: lines.length };
}

// ─── Names (JMnedict) ───

interface JMnedictEntry {
  id: string;
  kanji: { text: string; tags: string[] }[];
  kana: { text: string; tags: string[]; appliesToKanji: string[] }[];
  translation: {
    type: string[];
    related: string[][];
    translation: { lang: string; text: string }[];
  }[];
}

interface JMnedictData {
  version: string;
  dictDate: string;
  words: JMnedictEntry[];
}

async function getJmnedictUrl(): Promise<string> {
  console.log("  Resolving latest jmdict-simplified release...");
  const res = await fetch(
    "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest",
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const release = (await res.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find(
    (a) => a.name.startsWith("jmnedict-all-") && a.name.endsWith(".json.tgz"),
  );
  if (!asset) throw new Error("Could not find jmnedict-all tgz in latest release");
  console.log(`  Found: ${asset.name}`);
  return asset.browser_download_url;
}

async function buildNames(): Promise<{ filePath: string; rowCount: number }> {
  console.log("\n=== Building names.jsonl.gz ===\n");

  // Download JMnedict
  const tgzPath = path.join(CACHE_DIR, "jmnedict-all.json.tgz");
  if (!fs.existsSync(tgzPath)) {
    const url = await getJmnedictUrl();
    await downloadFile(url, tgzPath);
  } else {
    console.log(`  Using cached: ${path.basename(tgzPath)}`);
  }

  // Extract
  console.log("  Extracting...");
  const { execSync } = await import("child_process");
  const extractDir = path.join(CACHE_DIR, "jmnedict");
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`tar -xzf "${tgzPath}" -C "${extractDir}"`, { stdio: "inherit" });
  const files = fs
    .readdirSync(extractDir)
    .filter((f) => f.endsWith(".json") && f.startsWith("jmnedict"));
  if (files.length === 0) throw new Error("No jmnedict JSON found after extraction");
  const jsonPath = path.join(extractDir, files[0]);

  // Parse
  console.log("  Parsing JMnedict JSON...");
  const data: JMnedictData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`  ${data.words.length} name entries loaded`);

  // Convert to JSONL
  const lines: string[] = [];
  for (const entry of data.words) {
    const id = parseInt(entry.id, 10);
    const kanji = entry.kanji.map((k) => k.text);
    const kana = entry.kana.map((k) => k.text);

    // Collect all English translations and types
    const types = new Set<string>();
    const translations: string[] = [];
    for (const tr of entry.translation) {
      for (const t of tr.type) types.add(t);
      for (const tl of tr.translation) {
        if (tl.lang === "eng") translations.push(tl.text);
      }
    }

    const line: Record<string, unknown> = { id, r: kana };
    if (kanji.length > 0) line.k = kanji;
    if (types.size > 0) line.t = [...types].join(",");
    if (translations.length > 0) line.tr = translations.join("; ");

    lines.push(JSON.stringify(line));
  }

  console.log(`  ${lines.length} name entries processed`);

  // Write compressed JSONL
  const outPath = path.join(ASSETS_DIR, "names.jsonl.gz");
  const jsonl = lines.join("\n") + "\n";
  const compressed = zlib.gzipSync(Buffer.from(jsonl));
  fs.writeFileSync(outPath, compressed);
  console.log(
    `  Written: ${outPath} (${(compressed.length / 1024 / 1024).toFixed(1)} MB compressed, ${(jsonl.length / 1024 / 1024).toFixed(1)} MB uncompressed)`,
  );

  return { filePath: outPath, rowCount: lines.length };
}

// ─── Main ───

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const synonyms = await buildSynonyms();
  const names = await buildNames();

  // Update manifest with extended data section
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`dict-manifest.json not found at ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  const synonymsSize = fs.statSync(path.join(ASSETS_DIR, "synonyms.jsonl.gz")).size;
  const namesSize = fs.statSync(path.join(ASSETS_DIR, "names.jsonl.gz")).size;

  manifest.extended = {
    version: 1,
    datasets: {
      synonyms: {
        sizeBytes: synonymsSize,
        rowCount: synonyms.rowCount,
      },
      names: {
        sizeBytes: namesSize,
        rowCount: names.rowCount,
      },
    },
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
  console.log("\nDone! Run 'yarn publish:dict' to upload.");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
