/**
 * Parse JMdict XML to extract frequency tags (ke_pri/re_pri) per entry.
 *
 * The raw JMdict XML contains frequency information that jmdict-simplified
 * strips out (it only exposes a boolean `common` flag). We need the raw
 * nf01-nf48, ichi1/2, news1/2 tags for proper frequency ranking.
 *
 * nf tags: nf01 = top 500 newspaper words, nf02 = 501-1000, ... nf48 = 23501-24000
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { downloadFile, CACHE_DIR } from "./download";

const JMDICT_XML_URL = "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz";

export interface JMdictFreqEntry {
  /** Best (lowest) frequency rank derived from nf/ichi/news tags */
  rank: number;
  /** Whether the entry has ichi1 tag */
  ichi1: boolean;
  /** Whether the entry has news1 tag */
  news1: boolean;
}

/**
 * Convert an nf tag (e.g. "nf01") to an approximate rank.
 * nf01 = top 500, so midpoint = 250. nf02 = 501-1000, midpoint = 750, etc.
 */
function nfToRank(nf: string): number {
  const num = parseInt(nf.slice(2), 10);
  return num * 500 - 250;
}

/**
 * Download and parse JMdict XML to extract frequency data per entry.
 * Returns a map of entryId → frequency info.
 */
export async function loadJMdictFrequencies(): Promise<Map<number, JMdictFreqEntry>> {
  const gzPath = path.join(CACHE_DIR, "JMdict_e.gz");
  await downloadFile(JMDICT_XML_URL, gzPath);

  console.log("  Decompressing JMdict XML...");
  const compressed = fs.readFileSync(gzPath);
  const xml = zlib.gunzipSync(compressed).toString("utf-8");
  console.log(`  XML size: ${(xml.length / 1024 / 1024).toFixed(1)} MB`);

  const freqMap = new Map<number, JMdictFreqEntry>();

  // Parse entries using regex — JMdict XML has a very regular structure
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    // Extract ent_seq (entry ID)
    const seqMatch = block.match(/<ent_seq>(\d+)<\/ent_seq>/);
    if (!seqMatch) continue;
    const entryId = parseInt(seqMatch[1], 10);

    // Extract all ke_pri and re_pri tags
    const priTags: string[] = [];
    const priRegex = /<(?:ke_pri|re_pri)>([^<]+)<\/(?:ke_pri|re_pri)>/g;
    let priMatch: RegExpExecArray | null;
    while ((priMatch = priRegex.exec(block)) !== null) {
      priTags.push(priMatch[1]);
    }

    if (priTags.length === 0) continue;

    // Find the best nf rank
    let bestNfRank = Infinity;
    let hasIchi1 = false;
    let hasIchi2 = false;
    let hasNews1 = false;
    let hasNews2 = false;

    for (const tag of priTags) {
      if (tag.startsWith("nf")) {
        const rank = nfToRank(tag);
        if (rank < bestNfRank) bestNfRank = rank;
      } else if (tag === "ichi1") hasIchi1 = true;
      else if (tag === "ichi2") hasIchi2 = true;
      else if (tag === "news1") hasNews1 = true;
      else if (tag === "news2") hasNews2 = true;
    }

    // Determine final rank
    let rank: number;
    if (bestNfRank < Infinity) {
      rank = bestNfRank;
    } else if (hasIchi1) {
      // ichi1 words without nf tags — these are common but not in newspaper freq.
      // Estimate: roughly top 10,000
      rank = 5000;
    } else if (hasNews1) {
      rank = 8000;
    } else if (hasIchi2 || hasNews2) {
      rank = 15000;
    } else {
      // Has some pri tags (e.g. spec1/spec2) but no frequency indicators
      rank = 20000;
    }

    freqMap.set(entryId, { rank, ichi1: hasIchi1, news1: hasNews1 });
    count++;
  }

  console.log(`  ${count} entries with frequency data extracted from JMdict XML`);
  return freqMap;
}
