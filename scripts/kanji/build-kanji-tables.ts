/**
 * Kanji index build orchestrator.
 *
 * Downloads KANJIDIC2, KRADFILE, KanjiVG, and Lars Yencken ground truth,
 * parses all data, computes visual similarity vectors, and inserts
 * everything into the dictionary SQLite database.
 *
 * Called from build-dictionary.ts after the JMdict build is complete.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { parseKanjidic } from "./parse-kanjidic";
import { parseKradfile } from "./parse-kradfile";
import { parseKanjiVG } from "./parse-kanjivg";
import { samplePathPoints, type Point } from "./svg-path";
import {
  buildRadicalIndex,
  buildCombinedVector,
  computePairwiseSimilarity,
  validateAgainstGroundTruth,
} from "./similarity";

const CACHE_DIR = path.resolve(__dirname, "..", "..", ".cache");

const LARS_YENCKEN_URL =
  "https://lars.yencken.org/datasets/kanji-confusion/jyouyou__strokeEditDistance.csv";

async function downloadFile(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  Using cached: ${path.basename(dest)}`);
    return;
  }
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}

async function extractTgz(tgzPath: string, outDir: string, prefix: string): Promise<string> {
  const { execSync } = await import("child_process");
  fs.mkdirSync(outDir, { recursive: true });
  execSync(`tar -xzf "${tgzPath}" -C "${outDir}"`, { stdio: "inherit" });
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".json") && f.startsWith(prefix));
  if (files.length === 0) throw new Error(`No ${prefix} JSON found after extraction`);
  return path.join(outDir, files[0]);
}

/** Resolve download URLs from the latest jmdict-simplified release. */
async function getJmdictSimplifiedUrls(): Promise<{
  kanjidicUrl: string;
  kradfileUrl: string;
  kanjivgUrl: string;
}> {
  console.log("  Resolving jmdict-simplified release...");
  const res = await fetch(
    "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest",
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const release = (await res.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };

  const kanjidicAsset = release.assets.find(
    (a) => a.name.startsWith("kanjidic2-en-") && a.name.endsWith(".json.tgz"),
  );
  if (!kanjidicAsset) throw new Error("Could not find kanjidic2-en tgz in release");

  const kradfileAsset = release.assets.find(
    (a) => a.name.startsWith("kradfile-") && a.name.endsWith(".json.tgz"),
  );
  if (!kradfileAsset) throw new Error("Could not find kradfile tgz in release");

  // KanjiVG from its own repo
  console.log("  Resolving KanjiVG release...");
  const vgRes = await fetch("https://api.github.com/repos/KanjiVG/kanjivg/releases/latest", {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!vgRes.ok) throw new Error(`KanjiVG GitHub API error: ${vgRes.status}`);
  const vgRelease = (await vgRes.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };

  const kanjivgAsset = vgRelease.assets.find((a) => a.name.includes("-main.zip"));
  if (!kanjivgAsset) throw new Error("Could not find kanjivg-main.zip in release");

  return {
    kanjidicUrl: kanjidicAsset.browser_download_url,
    kradfileUrl: kradfileAsset.browser_download_url,
    kanjivgUrl: kanjivgAsset.browser_download_url,
  };
}

/** Parse the Lars Yencken ground truth CSV (space-separated). */
function parseLarsYencken(csvPath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!fs.existsSync(csvPath)) return result;

  const lines = fs.readFileSync(csvPath, "utf-8").split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;

    const pivot = parts[0];
    const similar: string[] = [];
    // Fields are: pivot sim1 score1 sim2 score2 ...
    for (let i = 1; i + 1 < parts.length; i += 2) {
      similar.push(parts[i]);
    }
    if (similar.length > 0) {
      result.set(pivot, similar);
    }
  }
  return result;
}

export async function buildKanjiTables(db: Database.Database): Promise<void> {
  console.log("\n═══ Building Kanji Index ═══\n");

  // ─── Step 1: Download sources ───
  console.log("10. Downloading kanji sources...");

  const kanjidicTgz = path.join(CACHE_DIR, "kanjidic2-en.json.tgz");
  const kradfileTgz = path.join(CACHE_DIR, "kradfile.json.tgz");
  const kanjivgZip = path.join(CACHE_DIR, "kanjivg-main.zip");
  const larsPath = path.join(CACHE_DIR, "jyouyou__strokeEditDistance.csv");

  const allCached = [kanjidicTgz, kradfileTgz, kanjivgZip, larsPath].every((f) => fs.existsSync(f));

  if (allCached) {
    console.log("  All kanji sources cached, skipping download");
  } else {
    const { kanjidicUrl, kradfileUrl, kanjivgUrl } = await getJmdictSimplifiedUrls();
    await Promise.all([
      downloadFile(kanjidicUrl, kanjidicTgz),
      downloadFile(kradfileUrl, kradfileTgz),
      downloadFile(kanjivgUrl, kanjivgZip),
      downloadFile(LARS_YENCKEN_URL, larsPath),
    ]);
  }

  // ─── Step 2: Parse KANJIDIC2 ───
  console.log("\n11. Parsing KANJIDIC2...");
  const kanjidicJson = await extractTgz(kanjidicTgz, CACHE_DIR, "kanjidic2-en");
  const kanjidic = parseKanjidic(kanjidicJson);

  // ─── Step 3: Parse KRADFILE ───
  console.log("\n12. Parsing KRADFILE...");
  const kradfileJson = await extractTgz(kradfileTgz, CACHE_DIR, "kradfile");
  const kradfile = parseKradfile(kradfileJson);

  // ─── Step 4: Parse KanjiVG ───
  console.log("\n13. Parsing KanjiVG...");
  const kanjivg = parseKanjiVG(kanjivgZip);

  // ─── Step 5: Build similarity vectors ───
  console.log("\n14. Building similarity vectors...");
  const { radicals: allRadicals, indexMap: radicalIndexMap } = buildRadicalIndex(kradfile);
  console.log(`  ${allRadicals.length} unique radicals`);

  // Sample points from KanjiVG for each kanji
  const kanjiPoints = new Map<string, Point[]>();
  for (const [literal, strokes] of kanjivg) {
    const allPts: Point[] = [];
    for (const stroke of strokes) {
      allPts.push(...samplePathPoints(stroke.d));
    }
    if (allPts.length > 0) kanjiPoints.set(literal, allPts);
  }
  console.log(`  ${kanjiPoints.size} kanji with grid data`);

  // Build combined vectors
  const vectors = new Map<string, Float32Array>();
  const allKanji = new Set([...kanjidic.keys(), ...kradfile.keys(), ...kanjivg.keys()]);

  for (const literal of allKanji) {
    const points = kanjiPoints.get(literal) ?? null;
    const rads = kradfile.get(literal) ?? null;
    const vec = buildCombinedVector(points, rads, radicalIndexMap, allRadicals.length);
    if (vec) vectors.set(literal, vec);
  }
  console.log(`  ${vectors.size} kanji with similarity vectors`);

  // ─── Step 6: Compute pairwise similarity ───
  console.log("\n15. Computing pairwise similarity...");
  const similarityResults = computePairwiseSimilarity(vectors, 20);

  // ─── Step 7: Create tables and insert data ───
  console.log("\n16. Inserting kanji data into database...");

  db.exec(`
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
      similarity_vector BLOB
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

  const insertChar = db.prepare(`
    INSERT OR REPLACE INTO kanji_characters
    (literal, grade, stroke_count, frequency_rank, jlpt_old, jlpt_level,
     readings_on, readings_kun, meanings, nanori,
     radical_classical, radical_nelson, heisig_index, unicode_codepoint,
     stroke_paths, similarity_vector)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRadical = db.prepare(
    "INSERT OR IGNORE INTO kanji_radicals (literal, radical) VALUES (?, ?)",
  );

  const insertSimilarity = db.prepare(
    "INSERT OR REPLACE INTO kanji_similarity (literal, similar, score, rank) VALUES (?, ?, ?, ?)",
  );

  // Insert all kanji characters
  let charCount = 0;
  const insertChars = db.transaction(() => {
    for (const literal of allKanji) {
      const kd = kanjidic.get(literal);
      const strokes = kanjivg.get(literal);
      const vec = vectors.get(literal);

      // Build stroke paths JSON
      let strokePathsJson: string | null = null;
      if (strokes && strokes.length > 0) {
        strokePathsJson = JSON.stringify(strokes.map((s) => ({ type: s.type, d: s.d })));
      }

      // Convert vector to blob
      let vectorBlob: Buffer | null = null;
      if (vec) {
        vectorBlob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      }

      insertChar.run(
        literal,
        kd?.grade ?? null,
        kd?.strokeCount ?? 0,
        kd?.frequencyRank ?? null,
        kd?.jlptOld ?? null,
        kd?.jlptLevel ?? null,
        kd?.readingsOn?.length ? JSON.stringify(kd.readingsOn) : null,
        kd?.readingsKun?.length ? JSON.stringify(kd.readingsKun) : null,
        kd?.meanings?.length ? JSON.stringify(kd.meanings) : null,
        kd?.nanori?.length ? JSON.stringify(kd.nanori) : null,
        kd?.radicalClassical ?? null,
        kd?.radicalNelson ?? null,
        kd?.heisigIndex ?? null,
        kd?.unicodeCodepoint ?? literal.codePointAt(0)!.toString(16),
        strokePathsJson,
        vectorBlob,
      );
      charCount++;
    }
  });
  insertChars();
  console.log(`  ${charCount} kanji characters inserted`);

  // Insert radical decompositions
  let radCount = 0;
  const insertRadicals = db.transaction(() => {
    for (const [literal, rads] of kradfile) {
      for (const rad of rads) {
        insertRadical.run(literal, rad);
        radCount++;
      }
    }
  });
  insertRadicals();
  console.log(`  ${radCount} kanji-radical mappings inserted`);

  // Insert similarity results
  let simCount = 0;
  const insertSimilarities = db.transaction(() => {
    for (const [literal, sims] of similarityResults) {
      for (const sim of sims) {
        insertSimilarity.run(literal, sim.literal, sim.score, sim.rank);
        simCount++;
      }
    }
  });
  insertSimilarities();
  console.log(`  ${simCount} similarity pairs inserted`);

  // ─── Step 8: Validate against ground truth ───
  console.log("\n17. Validating against Lars Yencken ground truth...");
  const groundTruth = parseLarsYencken(larsPath);
  if (groundTruth.size > 0) {
    validateAgainstGroundTruth(similarityResults, groundTruth);
  } else {
    console.log("  Skipped (ground truth file not found)");
  }

  // ─── Step 9: Create indexes and FTS ───
  console.log("\n18. Creating kanji indexes...");
  db.exec(`
    CREATE INDEX idx_kc_grade ON kanji_characters(grade);
    CREATE INDEX idx_kc_jlpt ON kanji_characters(jlpt_level);
    CREATE INDEX idx_kc_frequency ON kanji_characters(frequency_rank);
    CREATE INDEX idx_kc_stroke_count ON kanji_characters(stroke_count);
    CREATE INDEX idx_kc_radical ON kanji_characters(radical_classical);
    CREATE INDEX idx_kc_heisig ON kanji_characters(heisig_index);
    CREATE INDEX idx_kr_radical ON kanji_radicals(radical);
    CREATE INDEX idx_ks_literal_rank ON kanji_similarity(literal, rank);

    CREATE VIRTUAL TABLE kanji_meanings_fts USING fts5(
      meanings, literal UNINDEXED,
      tokenize='porter unicode61'
    );

    INSERT INTO kanji_meanings_fts (meanings, literal)
    SELECT meanings, literal
    FROM kanji_characters
    WHERE meanings IS NOT NULL;
  `);

  console.log("\n═══ Kanji Index Complete ═══\n");
}
