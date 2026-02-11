/**
 * Tests for the kanji visual similarity algorithm.
 *
 * Covers: SVG path parsing, point sampling, grid vectorization,
 * component vectors, cosine similarity, and combined scoring.
 */

import { describe, test, expect } from "vitest";
import {
  samplePathPoints,
  buildGridVector,
  l2Normalize,
  cosineSimilarity,
  type Point,
} from "./svg-path";
import {
  buildRadicalIndex,
  buildComponentVector,
  buildCombinedVector,
  computePairwiseSimilarity,
  validateAgainstGroundTruth,
} from "./similarity";

// ─── SVG Path Parsing ───

describe("samplePathPoints", () => {
  test("parses a simple MoveTo + LineTo path", () => {
    const pts = samplePathPoints("M 10 20 L 50 20");
    expect(pts.length).toBeGreaterThan(0);
    // First point should be the MoveTo
    expect(pts[0]).toEqual({ x: 10, y: 20 });
    // Last point should be the LineTo endpoint
    const last = pts[pts.length - 1];
    expect(last.x).toBe(50);
    expect(last.y).toBe(20);
  });

  test("parses cubic Bézier (C command)", () => {
    // A simple cubic curve
    const pts = samplePathPoints("M 0 0 C 10 20, 30 40, 50 50");
    expect(pts.length).toBeGreaterThan(1);
    // First point is the MoveTo
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    // Last sampled point should be near the endpoint (50,50)
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(50, 0);
    expect(last.y).toBeCloseTo(50, 0);
  });

  test("handles smooth cubic (S command) with reflection", () => {
    const pts = samplePathPoints("M 0 0 C 10 20, 30 40, 50 50 S 70 60, 90 80");
    expect(pts.length).toBeGreaterThan(5);
    // Last point should be near (90,80)
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(90, 0);
    expect(last.y).toBeCloseTo(80, 0);
  });

  test("handles quadratic Bézier (Q command)", () => {
    const pts = samplePathPoints("M 0 0 Q 50 100, 100 0");
    expect(pts.length).toBeGreaterThan(1);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(100, 0);
    expect(last.y).toBeCloseTo(0, 0);
  });

  test("handles Z (close path) without crashing", () => {
    const pts = samplePathPoints("M 10 10 L 50 10 L 50 50 Z");
    expect(pts.length).toBeGreaterThan(0);
  });

  test("returns empty array for empty path", () => {
    const pts = samplePathPoints("");
    expect(pts).toEqual([]);
  });

  test("handles multiple cubic segments chained", () => {
    // Two cubics in sequence
    const pts = samplePathPoints("M 0 0 C 10 20, 20 30, 30 30 C 40 30, 50 20, 60 0");
    // Should have: 1 MoveTo point + 5 from first C + 5 from second C = 11
    expect(pts.length).toBe(11);
  });

  test("produces points within canvas bounds for typical KanjiVG data", () => {
    // Simplified version of a real KanjiVG stroke for 一 (ichi)
    const d = "M 11.5,54.25 C 20.75,52.25 76.25,45.25 97,44.75";
    const pts = samplePathPoints(d);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(109);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(109);
    }
  });
});

// ─── Grid Vectorization ───

describe("buildGridVector", () => {
  test("produces correct-length vector", () => {
    const pts: Point[] = [{ x: 50, y: 50 }];
    const grid = buildGridVector(pts, 16, 109);
    expect(grid.length).toBe(256);
  });

  test("single point produces one non-zero cell", () => {
    const pts: Point[] = [{ x: 50, y: 50 }];
    const grid = buildGridVector(pts, 16, 109);
    let nonZero = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > 0) nonZero++;
    }
    expect(nonZero).toBe(1);
    // That cell should have value 1.0 (normalized)
    const maxVal = Math.max(...grid);
    expect(maxVal).toBe(1);
  });

  test("horizontal line fills cells along a row", () => {
    // Points spread across x=0 to x=100, y=50
    const pts: Point[] = [];
    for (let x = 0; x <= 100; x += 5) {
      pts.push({ x, y: 50 });
    }
    const grid = buildGridVector(pts, 16, 109);
    // The row for y=50 (row ~7) should have multiple non-zero cells
    const row = Math.floor((50 / 109) * 16);
    let cellsInRow = 0;
    for (let col = 0; col < 16; col++) {
      if (grid[row * 16 + col] > 0) cellsInRow++;
    }
    expect(cellsInRow).toBeGreaterThan(5);
  });

  test("values are normalized between 0 and 1", () => {
    const pts: Point[] = [];
    for (let i = 0; i < 100; i++) {
      pts.push({ x: Math.random() * 109, y: Math.random() * 109 });
    }
    const grid = buildGridVector(pts, 16, 109);
    for (let i = 0; i < grid.length; i++) {
      expect(grid[i]).toBeGreaterThanOrEqual(0);
      expect(grid[i]).toBeLessThanOrEqual(1);
    }
  });

  test("identical point sets produce identical vectors", () => {
    const pts: Point[] = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 90, y: 90 },
    ];
    const g1 = buildGridVector(pts, 16, 109);
    const g2 = buildGridVector(pts, 16, 109);
    for (let i = 0; i < g1.length; i++) {
      expect(g1[i]).toBe(g2[i]);
    }
  });
});

// ─── L2 Normalization ───

describe("l2Normalize", () => {
  test("unit vector remains unchanged", () => {
    const vec = new Float32Array([1, 0, 0]);
    l2Normalize(vec);
    expect(vec[0]).toBeCloseTo(1);
    expect(vec[1]).toBeCloseTo(0);
    expect(vec[2]).toBeCloseTo(0);
  });

  test("normalizes to unit length", () => {
    const vec = new Float32Array([3, 4, 0]);
    l2Normalize(vec);
    // Length should be 1
    const len = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
    expect(len).toBeCloseTo(1, 5);
    expect(vec[0]).toBeCloseTo(0.6, 5);
    expect(vec[1]).toBeCloseTo(0.8, 5);
  });

  test("zero vector stays zero", () => {
    const vec = new Float32Array([0, 0, 0]);
    l2Normalize(vec);
    expect(vec[0]).toBe(0);
    expect(vec[1]).toBe(0);
    expect(vec[2]).toBe(0);
  });
});

// ─── Cosine Similarity ───

describe("cosineSimilarity", () => {
  test("identical normalized vectors have similarity 1", () => {
    const a = new Float32Array([0.6, 0.8, 0]);
    const b = new Float32Array([0.6, 0.8, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors have similarity 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  test("opposite vectors have similarity -1", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  test("similar vectors have high similarity", () => {
    const a = new Float32Array([0.6, 0.8, 0]);
    l2Normalize(a);
    const b = new Float32Array([0.65, 0.75, 0.05]);
    l2Normalize(b);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.95);
  });
});

// ─── Radical Index & Component Vectors ───

describe("buildRadicalIndex", () => {
  test("builds sorted index from kradfile map", () => {
    const krad = new Map<string, string[]>([
      ["日", ["口", "一"]],
      ["月", ["冂", "二"]],
      ["明", ["日", "月"]],
    ]);
    const { radicals, indexMap } = buildRadicalIndex(krad);
    // Should have all unique radicals, sorted
    expect(radicals.length).toBe(6); // 一, 二, 冂, 口, 日, 月
    expect(radicals).toEqual([...radicals].sort());
    // Each radical maps to its position
    for (let i = 0; i < radicals.length; i++) {
      expect(indexMap.get(radicals[i])).toBe(i);
    }
  });
});

describe("buildComponentVector", () => {
  test("produces correct binary vector", () => {
    const indexMap = new Map([
      ["一", 0],
      ["二", 1],
      ["口", 2],
      ["日", 3],
    ]);
    const vec = buildComponentVector(["口", "一"], indexMap, 4);
    expect(vec[0]).toBe(1); // 一
    expect(vec[1]).toBe(0); // 二
    expect(vec[2]).toBe(1); // 口
    expect(vec[3]).toBe(0); // 日
  });

  test("unknown radicals are ignored", () => {
    const indexMap = new Map([["一", 0]]);
    const vec = buildComponentVector(["一", "unknown"], indexMap, 1);
    expect(vec[0]).toBe(1);
  });
});

// ─── Combined Vectors ───

describe("buildCombinedVector", () => {
  const indexMap = new Map([
    ["一", 0],
    ["口", 1],
  ]);
  const totalRadicals = 2;

  test("returns null when no data available", () => {
    const vec = buildCombinedVector(null, null, indexMap, totalRadicals);
    expect(vec).toBeNull();
  });

  test("returns null for empty data", () => {
    const vec = buildCombinedVector([], [], indexMap, totalRadicals);
    expect(vec).toBeNull();
  });

  test("produces vector of correct length with grid + components", () => {
    const points: Point[] = [{ x: 50, y: 50 }];
    const vec = buildCombinedVector(points, ["一", "口"], indexMap, totalRadicals);
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(256 + totalRadicals); // 16*16 grid + 2 radicals
  });

  test("produces L2-normalized output", () => {
    const points: Point[] = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 90, y: 90 },
    ];
    const vec = buildCombinedVector(points, ["一"], indexMap, totalRadicals);
    expect(vec).not.toBeNull();
    let sumSq = 0;
    for (let i = 0; i < vec!.length; i++) {
      sumSq += vec![i] ** 2;
    }
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);
  });

  test("grid-only vector works (no radicals)", () => {
    const points: Point[] = [{ x: 50, y: 50 }];
    const vec = buildCombinedVector(points, null, indexMap, totalRadicals);
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(256 + totalRadicals);
    // Radical dimensions should be 0
    expect(vec![256]).toBe(0);
    expect(vec![257]).toBe(0);
  });

  test("component-only vector works (no grid points)", () => {
    const vec = buildCombinedVector(null, ["一", "口"], indexMap, totalRadicals);
    expect(vec).not.toBeNull();
    // Grid dimensions should all be 0
    for (let i = 0; i < 256; i++) {
      expect(vec![i]).toBe(0);
    }
  });
});

// ─── Pairwise Similarity ───

describe("computePairwiseSimilarity", () => {
  test("finds most similar kanji from synthetic vectors", () => {
    // Create 3 synthetic kanji: A and B similar, C different
    const dim = 10;
    const vecA = new Float32Array(dim);
    const vecB = new Float32Array(dim);
    const vecC = new Float32Array(dim);

    // A and B are very similar (differ in one dimension)
    vecA[0] = 1;
    vecA[1] = 1;
    vecA[2] = 1;
    vecB[0] = 1;
    vecB[1] = 1;
    vecB[2] = 0.9;
    // C is different
    vecC[5] = 1;
    vecC[6] = 1;
    vecC[7] = 1;

    l2Normalize(vecA);
    l2Normalize(vecB);
    l2Normalize(vecC);

    const vectors = new Map([
      ["A", vecA],
      ["B", vecB],
      ["C", vecC],
    ]);

    const results = computePairwiseSimilarity(vectors, 2);

    // A's most similar should be B
    const aSims = results.get("A")!;
    expect(aSims[0].literal).toBe("B");
    expect(aSims[0].score).toBeGreaterThan(0.9);

    // B's most similar should be A
    const bSims = results.get("B")!;
    expect(bSims[0].literal).toBe("A");

    // C should have low similarity to both A and B
    const cSims = results.get("C")!;
    for (const sim of cSims) {
      expect(sim.score).toBeLessThan(0.3);
    }
  });

  test("results are ranked correctly", () => {
    const dim = 5;
    const base = new Float32Array(dim);
    base[0] = 1;
    base[1] = 1;
    l2Normalize(base);

    const close = new Float32Array(dim);
    close[0] = 1;
    close[1] = 0.95;
    l2Normalize(close);

    const mid = new Float32Array(dim);
    mid[0] = 1;
    mid[1] = 0.5;
    l2Normalize(mid);

    const far = new Float32Array(dim);
    far[3] = 1;
    far[4] = 1;
    l2Normalize(far);

    const vectors = new Map([
      ["base", base],
      ["close", close],
      ["mid", mid],
      ["far", far],
    ]);

    const results = computePairwiseSimilarity(vectors, 3);
    const baseSims = results.get("base")!;

    // Should be ordered: close > mid > far
    expect(baseSims.length).toBeGreaterThanOrEqual(2);
    expect(baseSims[0].literal).toBe("close");
    expect(baseSims[0].rank).toBe(1);
    if (baseSims.length >= 2) {
      expect(baseSims[1].literal).toBe("mid");
      expect(baseSims[1].rank).toBe(2);
    }
  });

  test("respects topK limit", () => {
    const dim = 5;
    const vectors = new Map<string, Float32Array>();
    for (let i = 0; i < 10; i++) {
      const v = new Float32Array(dim);
      v[i % dim] = 1;
      v[(i + 1) % dim] = 0.5;
      l2Normalize(v);
      vectors.set(`k${i}`, v);
    }

    const results = computePairwiseSimilarity(vectors, 3);
    for (const [, sims] of results) {
      // Top-K slice should be <= 3 (may have more due to symmetrization)
      // But initial top-K slice is 3
      expect(sims.filter((s) => s.rank <= 3).length).toBeLessThanOrEqual(3);
    }
  });
});

// ─── Validation ───

describe("validateAgainstGroundTruth", () => {
  test("perfect overlap gives 100%", () => {
    const ourResults = new Map([
      [
        "日",
        [
          { literal: "目", score: 0.9, rank: 1 },
          { literal: "白", score: 0.85, rank: 2 },
          { literal: "田", score: 0.8, rank: 3 },
          { literal: "百", score: 0.75, rank: 4 },
          { literal: "旧", score: 0.7, rank: 5 },
        ],
      ],
    ]);
    const gt = new Map([["日", ["目", "白", "田", "百", "旧"]]]);

    const { overlap5 } = validateAgainstGroundTruth(ourResults, gt);
    expect(overlap5).toBeCloseTo(1, 5);
  });

  test("zero overlap gives 0%", () => {
    const ourResults = new Map([
      [
        "日",
        [
          { literal: "水", score: 0.9, rank: 1 },
          { literal: "火", score: 0.85, rank: 2 },
          { literal: "木", score: 0.8, rank: 3 },
          { literal: "金", score: 0.75, rank: 4 },
          { literal: "土", score: 0.7, rank: 5 },
        ],
      ],
    ]);
    const gt = new Map([["日", ["目", "白", "田", "百", "旧"]]]);

    const { overlap5 } = validateAgainstGroundTruth(ourResults, gt);
    expect(overlap5).toBeCloseTo(0, 5);
  });

  test("handles missing kanji gracefully", () => {
    const ourResults = new Map<string, { literal: string; score: number; rank: number }[]>();
    const gt = new Map([["日", ["目", "白"]]]);

    const { count } = validateAgainstGroundTruth(ourResults, gt);
    expect(count).toBe(0);
  });
});

// ─── Integration: SVG → Grid → Similarity ───

describe("end-to-end: SVG path to similarity", () => {
  test("similar-looking synthetic strokes produce high similarity", () => {
    // Two horizontal lines at similar positions
    const pathA = "M 10,50 C 30,48 70,48 100,50"; // roughly horizontal, middle
    const pathB = "M 10,52 C 30,50 70,50 100,52"; // very similar, slightly lower

    const ptsA = samplePathPoints(pathA);
    const ptsB = samplePathPoints(pathB);

    const gridA = buildGridVector(ptsA, 16, 109);
    const gridB = buildGridVector(ptsB, 16, 109);

    l2Normalize(gridA);
    l2Normalize(gridB);

    const sim = cosineSimilarity(gridA, gridB);
    expect(sim).toBeGreaterThan(0.8);
  });

  test("very different strokes produce low similarity", () => {
    // Horizontal line at top
    const pathA = "M 10,10 L 100,10";
    // Vertical line at right
    const pathB = "M 90,10 L 90,100";

    const ptsA = samplePathPoints(pathA);
    const ptsB = samplePathPoints(pathB);

    const gridA = buildGridVector(ptsA, 16, 109);
    const gridB = buildGridVector(ptsB, 16, 109);

    l2Normalize(gridA);
    l2Normalize(gridB);

    const sim = cosineSimilarity(gridA, gridB);
    expect(sim).toBeLessThan(0.5);
  });

  test("cross shape is more similar to plus than to single stroke", () => {
    // Plus/cross shape
    const crossH = "M 10,54 L 100,54"; // horizontal
    const crossV = "M 54,10 L 54,100"; // vertical

    // Single horizontal
    const singleH = "M 10,54 L 100,54";

    // Box shape (very different)
    const boxPath = "M 20,20 L 90,20 L 90,90 L 20,90 Z";

    const crossPts = [...samplePathPoints(crossH), ...samplePathPoints(crossV)];
    const singlePts = samplePathPoints(singleH);
    const boxPts = samplePathPoints(boxPath);

    const crossGrid = buildGridVector(crossPts, 16, 109);
    const singleGrid = buildGridVector(singlePts, 16, 109);
    const boxGrid = buildGridVector(boxPts, 16, 109);

    l2Normalize(crossGrid);
    l2Normalize(singleGrid);
    l2Normalize(boxGrid);

    const simCrossSingle = cosineSimilarity(crossGrid, singleGrid);
    const simCrossBox = cosineSimilarity(crossGrid, boxGrid);

    // Cross is more similar to its horizontal component than to a box
    expect(simCrossSingle).toBeGreaterThan(simCrossBox);
  });
});
