/**
 * Kanji visual similarity engine.
 *
 * Combines spatial grid features (from KanjiVG stroke data) with
 * component features (from KRADFILE radical decomposition) to produce
 * a combined similarity vector per kanji. Pairwise cosine similarity
 * on these vectors gives a continuous visual similarity metric.
 */

import { type Point, buildGridVector, l2Normalize, cosineSimilarity } from "./svg-path";

const GRID_SIZE = 16;
const GRID_WEIGHT = 0.7;
const COMPONENT_WEIGHT = 0.3;

export interface SimilarityResult {
  literal: string;
  score: number;
  rank: number;
}

/**
 * Build the radical index: a sorted list of all unique radicals.
 * Returns the index array and a map from radical → position.
 */
export function buildRadicalIndex(kradfile: Map<string, string[]>): {
  radicals: string[];
  indexMap: Map<string, number>;
} {
  const radicalSet = new Set<string>();
  for (const rads of kradfile.values()) {
    for (const r of rads) radicalSet.add(r);
  }
  const radicals = [...radicalSet].sort();
  const indexMap = new Map<string, number>();
  for (let i = 0; i < radicals.length; i++) {
    indexMap.set(radicals[i], i);
  }
  return { radicals, indexMap };
}

/**
 * Build a binary component vector for a kanji from its radical list.
 */
export function buildComponentVector(
  radicals: string[],
  indexMap: Map<string, number>,
  totalRadicals: number,
): Float32Array {
  const vec = new Float32Array(totalRadicals);
  for (const r of radicals) {
    const idx = indexMap.get(r);
    if (idx !== undefined) vec[idx] = 1;
  }
  return vec;
}

/**
 * Build the combined similarity vector for a kanji.
 *
 * @param gridPoints - Sampled points from KanjiVG strokes (null if no VG data)
 * @param radicals - Radical list from KRADFILE (null if no KRAD data)
 * @param radicalIndexMap - Map from radical string to index position
 * @param totalRadicals - Total number of unique radicals
 * @returns Combined Float32Array vector, or null if no data available
 */
export function buildCombinedVector(
  gridPoints: Point[] | null,
  radicals: string[] | null,
  radicalIndexMap: Map<string, number>,
  totalRadicals: number,
): Float32Array | null {
  const hasGrid = gridPoints !== null && gridPoints.length > 0;
  const hasComponents = radicals !== null && radicals.length > 0;

  if (!hasGrid && !hasComponents) return null;

  const gridDims = GRID_SIZE * GRID_SIZE; // 256
  const totalDims = gridDims + totalRadicals;
  const combined = new Float32Array(totalDims);

  if (hasGrid) {
    const gridVec = buildGridVector(gridPoints, GRID_SIZE);
    l2Normalize(gridVec);
    for (let i = 0; i < gridDims; i++) {
      combined[i] = gridVec[i] * GRID_WEIGHT;
    }
  }

  if (hasComponents) {
    const compVec = buildComponentVector(radicals, radicalIndexMap, totalRadicals);
    l2Normalize(compVec);
    for (let i = 0; i < totalRadicals; i++) {
      combined[gridDims + i] = compVec[i] * COMPONENT_WEIGHT;
    }
  }

  l2Normalize(combined);
  return combined;
}

/**
 * Insert into a bounded min-heap (sorted array kept at max size K).
 * The array is kept sorted by score ascending so the minimum is at index 0.
 */
function insertTopK(
  heap: { literal: string; score: number }[],
  entry: { literal: string; score: number },
  k: number,
): void {
  if (heap.length < k) {
    // Not full yet — insert in sorted position
    let i = heap.length;
    heap.push(entry);
    while (i > 0 && heap[i].score < heap[i - 1].score) {
      const tmp = heap[i];
      heap[i] = heap[i - 1];
      heap[i - 1] = tmp;
      i--;
    }
  } else if (entry.score > heap[0].score) {
    // Replace the minimum
    heap[0] = entry;
    // Bubble up to maintain sorted order
    for (let i = 0; i < heap.length - 1 && heap[i].score > heap[i + 1].score; i++) {
      const tmp = heap[i];
      heap[i] = heap[i + 1];
      heap[i + 1] = tmp;
    }
  }
}

/**
 * Compute top-K most similar kanji for each kanji with a similarity vector.
 * Uses bounded heaps to keep memory O(n * topK) instead of O(n²).
 *
 * @param vectors - Map from kanji literal to its combined vector
 * @param topK - Number of similar kanji to store per entry (default 20)
 * @returns Map from kanji literal to sorted array of SimilarityResults
 */
export function computePairwiseSimilarity(
  vectors: Map<string, Float32Array>,
  topK: number = 20,
): Map<string, SimilarityResult[]> {
  const entries = [...vectors.entries()];
  const n = entries.length;

  // Bounded top-K heaps per kanji — memory stays at O(n * topK)
  const heaps = new Map<string, { literal: string; score: number }[]>();
  for (let i = 0; i < n; i++) {
    heaps.set(entries[i][0], []);
  }

  console.log(`  Computing pairwise similarity for ${n} kanji...`);
  const startTime = Date.now();

  for (let i = 0; i < n; i++) {
    const [litA, vecA] = entries[i];
    const heapA = heaps.get(litA)!;

    for (let j = i + 1; j < n; j++) {
      const [litB, vecB] = entries[j];
      const score = cosineSimilarity(vecA, vecB);

      if (score > 0.1) {
        insertTopK(heapA, { literal: litB, score }, topK);
        insertTopK(heaps.get(litB)!, { literal: litA, score }, topK);
      }
    }

    if ((i + 1) % 1000 === 0) {
      console.log(`  ${i + 1}/${n} kanji processed...`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Pairwise similarity computed in ${elapsed}s`);

  // Convert heaps to sorted results (descending by score)
  const topResults = new Map<string, SimilarityResult[]>();

  for (const [lit, heap] of heaps) {
    heap.sort((a, b) => b.score - a.score);
    topResults.set(
      lit,
      heap.map((s, idx) => ({
        literal: s.literal,
        score: s.score,
        rank: idx + 1,
      })),
    );
  }

  return topResults;
}

/**
 * Validate similarity results against Lars Yencken ground truth.
 * Prints overlap@5, overlap@10, and Spearman correlation statistics.
 */
export function validateAgainstGroundTruth(
  ourResults: Map<string, SimilarityResult[]>,
  groundTruth: Map<string, string[]>,
): { overlap5: number; overlap10: number; count: number } {
  let totalOverlap5 = 0;
  let totalOverlap10 = 0;
  let count = 0;

  for (const [pivot, gtList] of groundTruth) {
    const ours = ourResults.get(pivot);
    if (!ours || ours.length === 0) continue;

    const ourTop5 = new Set(ours.slice(0, 5).map((s) => s.literal));
    const ourTop10 = new Set(ours.slice(0, 10).map((s) => s.literal));
    const gtTop5 = new Set(gtList.slice(0, 5));
    const gtTop10 = new Set(gtList.slice(0, 10));

    let o5 = 0;
    for (const k of ourTop5) if (gtTop5.has(k)) o5++;
    let o10 = 0;
    for (const k of ourTop10) if (gtTop10.has(k)) o10++;

    totalOverlap5 += o5 / Math.min(5, gtTop5.size);
    totalOverlap10 += o10 / Math.min(10, gtTop10.size);
    count++;
  }

  const overlap5 = count > 0 ? totalOverlap5 / count : 0;
  const overlap10 = count > 0 ? totalOverlap10 / count : 0;

  console.log(`  Validation against Lars Yencken ground truth:`);
  console.log(`    Kanji with ground truth data: ${count}`);
  console.log(`    Average overlap@5:  ${(overlap5 * 100).toFixed(1)}%`);
  console.log(`    Average overlap@10: ${(overlap10 * 100).toFixed(1)}%`);

  return { overlap5, overlap10, count };
}
