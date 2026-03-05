/**
 * Generate frequency-based JLPT word classifications for all common JMdict entries.
 *
 * Usage: yarn build:jlpt
 *
 * Output: data/jlpt-words.csv
 *
 * Data sources:
 * 1. JMdict XML frequency tags (nf01-nf48, ichi1/2, news1/2) — primary
 * 2. JPDB frequency list (anime/novels/media corpus) — secondary
 *
 * Algorithm:
 * - JPDB (lemma-based) is primary; JMdict nf only used as penalty for
 *   literary-skewed words (high JPDB but rare in newspapers)
 * - Sort all ~22K common entries by combined rank
 * - Assign JLPT levels by position: N5=800, N4=1500, N3=3700, N2=6000, N1=rest
 */

import * as fs from "fs";
import * as path from "path";
import { loadJMdictFrequencies } from "./lib/jmdict-freq";
import { loadNovelFrequencies, matchNovelFrequencies } from "./lib/novel-freq";
import { CACHE_DIR } from "./lib/download";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "data");
const CSV_PATH = path.join(OUT_DIR, "jlpt-words.csv");

// JLPT level thresholds (cumulative count)
const LEVEL_THRESHOLDS = [
  { level: 5, count: 800 },
  { level: 4, count: 1500 },
  { level: 3, count: 3700 },
  { level: 2, count: 6000 },
  // N1 = everything else
];

// POS tags to exclude from JLPT classification (archaic/obscene/specialist)
const EXCLUDED_POS = new Set(["archaic", "archaism", "obsolete term", "obscure term"]);

// Misc tags that indicate words to exclude
const EXCLUDED_MISC = new Set([
  "archaic",
  "archaism",
  "obsolete term",
  "vulgar expression or word",
  "derogatory",
  "manga slang",
  "Internet slang",
]);

interface JMdictWord {
  id: string;
  kanji: { text: string; common: boolean; tags: string[] }[];
  kana: {
    text: string;
    common: boolean;
    tags: string[];
    appliesToKanji: string[];
  }[];
  sense: {
    partOfSpeech: string[];
    appliesToKanji: string[];
    appliesToKana: string[];
    related: string[][];
    antonym: string[][];
    field: string[];
    dialect: string[];
    misc: string[];
    info: string[];
    languageSource: unknown[];
    gloss: { lang: string; text: string }[];
  }[];
}

interface JMdictData {
  words: JMdictWord[];
}

interface RankedEntry {
  id: number;
  kanji: string;
  reading: string;
  combinedRank: number;
  jlptLevel: number;
  glosses: string;
}

// JMdict nf ranks massively undercount inflectable words because nf is form-based
// (食べる has low nf but 食べた/食べて/食べました are counted as separate forms)
// JMdict-simplified uses abbreviated POS codes: v1=ichidan, v5*=godan, adj-i, etc.
function isInflectable(word: JMdictWord): boolean {
  return word.sense.some((s) =>
    s.partOfSpeech.some(
      (p) => p.startsWith("v") || p === "adj-i" || p === "adj-ix" || p === "adj-na",
    ),
  );
}

function loadJMdictSimplified(): JMdictData {
  // Find the cached jmdict-eng JSON
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("jmdict-eng-") && f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(
      "No jmdict-eng JSON found in .cache/. Run yarn build:db first to download JMdict data.",
    );
  }
  const jsonPath = path.join(CACHE_DIR, files[0]);
  console.log(`  Loading JMdict simplified: ${files[0]}`);
  return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
}

function shouldExclude(word: JMdictWord): boolean {
  // Check if ALL senses have excluded POS or misc tags
  return word.sense.every((s) => {
    const hasExcludedMisc = s.misc.some((m) => EXCLUDED_MISC.has(m));
    const hasExcludedPos = s.partOfSpeech.some((p) => EXCLUDED_POS.has(p));
    return hasExcludedMisc || hasExcludedPos;
  });
}

function getPrimaryForm(word: JMdictWord): { kanji: string; reading: string } {
  const kanji = word.kanji.length > 0 ? word.kanji[0].text : "";
  const reading = word.kana.length > 0 ? word.kana[0].text : "";
  return { kanji, reading };
}

function getFirstGloss(word: JMdictWord): string {
  for (const s of word.sense) {
    for (const g of s.gloss) {
      if (g.lang === "eng") return g.text;
    }
  }
  return "";
}

async function main() {
  console.log("=== JLPT Word List Generator ===\n");

  // 1. Load JMdict simplified to get common entries list + metadata
  console.log("1. Loading JMdict simplified JSON...");
  const jmdict = loadJMdictSimplified();
  const commonWords = jmdict.words.filter(
    (w) => w.kanji.some((k) => k.common) || w.kana.some((k) => k.common),
  );
  console.log(`   ${jmdict.words.length} total entries, ${commonWords.length} common entries`);

  // 2. Load JMdict XML frequency data
  console.log("\n2. Loading JMdict XML frequency tags...");
  const jmdictFreq = await loadJMdictFrequencies();

  // 3. Load JPDB frequency data
  console.log("\n3. Loading JPDB frequency data...");
  const jpdbRawFreq = await loadNovelFrequencies();

  // Build kanji/kana lookup for matching
  const entryForms = new Map<number, { kanji: string[]; kana: string[] }>();
  for (const word of commonWords) {
    const id = parseInt(word.id, 10);
    entryForms.set(id, {
      kanji: word.kanji.map((k) => k.text),
      kana: word.kana.map((k) => k.text),
    });
  }

  const jpdbFreq = matchNovelFrequencies(entryForms, jpdbRawFreq);
  console.log(`   ${jpdbFreq.size} common entries matched with JPDB frequency`);

  // 4. Compute combined ranks using positional ranking
  // (rank by position within each frequency list, then combine positions)
  console.log("\n4. Computing combined frequency ranks...");

  // Collect all common entries with metadata
  interface EntryData {
    id: number;
    word: JMdictWord;
    jmdictRank: number | null; // raw rank from JMdict XML
    jpdbRank: number | null; // raw rank from JPDB
  }
  const allEntries: EntryData[] = [];
  let excluded = 0;

  for (const word of commonWords) {
    const id = parseInt(word.id, 10);
    if (shouldExclude(word)) {
      excluded++;
      continue;
    }

    const jmFreq = jmdictFreq.get(id);
    const jpFreq = jpdbFreq.get(id) ?? null;

    allEntries.push({
      id,
      word,
      jmdictRank: jmFreq?.rank ?? null,
      jpdbRank: jpFreq,
    });
  }

  // Step 1: Sort entries by each signal and assign position ranks
  // JMdict position rank (among entries that have JMdict data)
  const withJmdict = allEntries.filter((e) => e.jmdictRank != null);
  withJmdict.sort((a, b) => a.jmdictRank! - b.jmdictRank!);
  const jmPositionRank = new Map<number, number>();
  for (let i = 0; i < withJmdict.length; i++) {
    jmPositionRank.set(withJmdict[i].id, i + 1);
  }

  // JPDB position rank (among entries that have JPDB data)
  const withJpdb = allEntries.filter((e) => e.jpdbRank != null);
  withJpdb.sort((a, b) => a.jpdbRank! - b.jpdbRank!);
  const jpdbPositionRank = new Map<number, number>();
  for (let i = 0; i < withJpdb.length; i++) {
    jpdbPositionRank.set(withJpdb[i].id, i + 1);
  }

  // Normalize position ranks to [0, 1]
  const totalJm = withJmdict.length;
  const totalJpdb = withJpdb.length;

  let withBoth = 0;
  let jmdictOnly = 0;
  let jpdbOnly = 0;
  let neither = 0;

  const rankedEntries: RankedEntry[] = [];

  for (const entry of allEntries) {
    const jmPos = jmPositionRank.get(entry.id);
    const jpPos = jpdbPositionRank.get(entry.id);

    let combinedRank: number;

    if (jpPos != null) {
      // JPDB frequency (anime/novels/media) is the primary signal.
      // It's lemma-based (all conjugations grouped under dictionary form),
      // unlike JMdict nf which is form-based and massively undercounts
      // verbs/adjectives (食べる nf=12250 because 食べた/食べて are separate).
      //
      // JMdict nf only used as a penalty for JPDB-only-high words that
      // don't appear in general usage (pure literary/fiction vocabulary).
      const normJp = jpPos / totalJpdb;
      if (jmPos != null) {
        const inflectable = isInflectable(entry.word);
        if (inflectable) {
          // Verbs/adjectives: pure JPDB. JMdict nf is form-based and
          // massively undercounts these (食べる nf=12250 because 食べた/食べて
          // are counted separately). Any JMdict penalty would be noise.
          combinedRank = normJp;
        } else {
          // Nouns/other: penalize literary-skewed words (high JPDB but
          // absent/rare in newspapers). Only positive adjustments (never boost).
          const normJm = jmPos / totalJm;
          const jmPenalty = Math.max(0, Math.min(0.08, (normJm - normJp) * 0.2));
          combinedRank = normJp + jmPenalty;
        }
        withBoth++;
      } else {
        // JPDB only (no newspaper freq) — likely literary/niche, add penalty
        combinedRank = 0.1 + normJp * 0.9;
        jpdbOnly++;
      }
    } else if (jmPos != null) {
      // JMdict only (no JPDB match) — use JMdict with penalty
      combinedRank = 0.3 + (jmPos / totalJm) * 0.7;
      jmdictOnly++;
    } else {
      // No frequency data — push to tail
      combinedRank = 1.0;
      neither++;
    }

    const { kanji, reading } = getPrimaryForm(entry.word);
    const glosses = getFirstGloss(entry.word);

    rankedEntries.push({
      id: entry.id,
      kanji,
      reading,
      combinedRank,
      jlptLevel: 0,
      glosses,
    });
  }

  console.log(`   Both signals: ${withBoth}`);
  console.log(`   JMdict only: ${jmdictOnly}`);
  console.log(`   JPDB only: ${jpdbOnly}`);
  console.log(`   No frequency data: ${neither}`);
  console.log(`   Excluded (archaic/obscene): ${excluded}`);

  // Sort by combined rank (lowest = most frequent)
  rankedEntries.sort((a, b) => a.combinedRank - b.combinedRank);

  // 5. Pin seed words, then assign JLPT levels by cumulative position
  console.log("\n5. Assigning JLPT levels...");

  // Seed list: universally-basic words that every beginner knows but may
  // rank low in novel frequency (daily-life vocab underrepresented in fiction).
  // These get pinned to N5 by forcing combinedRank = 0 (sorts to top).
  // Words already ranking in N5 are unaffected; this only rescues stragglers.
  const N5_SEED_KANJI = new Set([
    // Daily life nouns
    "電車",
    "駅",
    "空港",
    "病院",
    "銀行",
    "郵便局",
    "交番",
    "図書館",
    "天気",
    "切符",
    "地図",
    "写真",
    "旅行",
    "料理",
    "食堂",
    "台所",
    "冷蔵庫",
    "洗濯機",
    "自転車",
    "飛行機",
    "信号",
    "地下鉄",
    // Food & drink
    "魚",
    "肉",
    "野菜",
    "果物",
    "牛乳",
    "卵",
    "茶",
    "酒",
    "弁当",
    "米",
    // Animals
    "犬",
    "猫",
    "馬",
    "鳥",
    // Family
    "お父さん",
    "お母さん",
    "兄",
    "姉",
    "弟",
    "妹",
    "祖父",
    "祖母",
    // Body
    "頭",
    "目",
    "鼻",
    "歯",
    // Time & calendar
    "朝",
    "昼",
    "午前",
    "午後",
    "来週",
    "来月",
    "来年",
    "去年",
    "毎日",
    "毎週",
    "毎月",
    "毎年",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日",
    "日曜日",
    // Numbers & counters
    "百",
    "千",
    "万",
    // Directions & position
    "東",
    "西",
    "南",
    "北",
    "右",
    "左",
    "上",
    "下",
    "前",
    "横",
    "隣",
    // Basic adjectives that rank low in novels
    "安い",
    "古い",
    "暖かい",
    "涼しい",
    "丸い",
    // School & work
    "宿題",
    "教室",
    "試験",
    "授業",
    "質問",
    "答え",
    "練習",
    // Basic verbs that might slip
    "泳ぐ",
    "届ける",
    "届く",
    // Seasons
    "春",
    "夏",
    "秋",
    "冬",
  ]);

  const N5_SEED_READING = new Set([
    // Kana-only words that are obviously N5
    "トイレ",
    "テレビ",
    "エアコン",
    "スーパー",
    "コンビニ",
    "バス",
    "タクシー",
    "エレベーター",
    "シャワー",
  ]);

  let pinned = 0;
  for (const entry of rankedEntries) {
    if (N5_SEED_KANJI.has(entry.kanji) || N5_SEED_READING.has(entry.reading)) {
      if (entry.combinedRank > 0.035) {
        // Only pin if not already in N5 range (top ~800 of ~22K ≈ 0.035)
        entry.combinedRank = 0.034; // push into N5 range
        pinned++;
      }
    }
  }
  console.log(`   Pinned ${pinned} seed words to N5`);

  // Re-sort after pinning
  rankedEntries.sort((a, b) => a.combinedRank - b.combinedRank);

  for (let i = 0; i < rankedEntries.length; i++) {
    const pos = i + 1; // 1-indexed position
    // Find which level this position falls into
    let level = 1; // default N1
    let cumulative = 0;
    for (const t of LEVEL_THRESHOLDS) {
      cumulative += t.count;
      if (pos <= cumulative) {
        level = t.level;
        break;
      }
    }
    rankedEntries[i].jlptLevel = level;
  }

  // 6. Generate CSV
  console.log("\n6. Writing CSV...");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = "jmdict_id,kanji,reading,jlpt_level,frequency_rank";
  const lines = [header];

  for (let i = 0; i < rankedEntries.length; i++) {
    const e = rankedEntries[i];
    // Escape kanji/reading fields for CSV (wrap in quotes if they contain commas)
    const kanjiField = e.kanji.includes(",") ? `"${e.kanji}"` : e.kanji;
    const readingField = e.reading.includes(",") ? `"${e.reading}"` : e.reading;
    lines.push(`${e.id},${kanjiField},${readingField},${e.jlptLevel},${i + 1}`);
  }

  fs.writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`   Written ${rankedEntries.length} entries to ${CSV_PATH}`);

  // 7. Print summary
  console.log("\n=== Summary ===\n");

  const levelCounts = new Map<number, number>();
  for (const e of rankedEntries) {
    levelCounts.set(e.jlptLevel, (levelCounts.get(e.jlptLevel) ?? 0) + 1);
  }

  console.log("Distribution:");
  for (const level of [5, 4, 3, 2, 1]) {
    console.log(`  N${level}: ${levelCounts.get(level) ?? 0} words`);
  }
  console.log(`  Total: ${rankedEntries.length} words`);

  // Show first 20 words per level
  console.log("\nFirst 20 words per level:");
  for (const level of [5, 4, 3, 2, 1]) {
    const words = rankedEntries.filter((e) => e.jlptLevel === level).slice(0, 20);
    console.log(
      `\n  N${level}:`,
      words.map((w) => `${w.kanji || w.reading}(${w.glosses})`).join(", "),
    );
  }

  // Spot-check known problem words
  console.log("\n\nSpot-check (previously misclassified words):");
  const checkWords = [
    "言う",
    "食べる",
    "飲む",
    "行く",
    "見る",
    "書く",
    "読む",
    "大きい",
    "小さい",
    "高い",
    "安い",
    "新しい",
    "町",
    "魚",
    "馬",
    "犬",
    "猫",
    "水",
    "電車",
    "学校",
    "先生",
    "笑う",
    "走る",
    "歩く",
  ];
  for (const target of checkWords) {
    const entry = rankedEntries.find((e) => e.kanji === target || e.reading === target);
    if (entry) {
      console.log(`  ${target}: N${entry.jlptLevel} (rank #${rankedEntries.indexOf(entry) + 1})`);
    } else {
      console.log(`  ${target}: NOT FOUND`);
    }
  }
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
