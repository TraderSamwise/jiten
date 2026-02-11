/**
 * SVG path d-attribute parser and point sampler.
 *
 * Parses M, L, C, S, Q, Z commands (absolute only — KanjiVG uses absolute coords)
 * and samples evenly-spaced points along the resulting curves.
 */

export interface Point {
  x: number;
  y: number;
}

interface CubicSegment {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

interface QuadSegment {
  p0: Point;
  p1: Point;
  p2: Point;
}

/** Tokenize an SVG path d-attribute into command + number sequences. */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const result: { cmd: string; args: number[] }[] = [];
  // Match command letters followed by their numeric arguments
  const cmdRegex = /([MLCSQZmlcsqz])\s*([-\d.,eE\s]*)/g;
  let match: RegExpExecArray | null;

  while ((match = cmdRegex.exec(d)) !== null) {
    const cmd = match[1];
    const argStr = match[2].trim();
    const args: number[] = [];
    if (argStr.length > 0) {
      // Split on commas or whitespace, handling negative numbers
      const numRegex = /-?\d*\.?\d+(?:[eE][+-]?\d+)?/g;
      let numMatch: RegExpExecArray | null;
      while ((numMatch = numRegex.exec(argStr)) !== null) {
        args.push(parseFloat(numMatch[0]));
      }
    }
    result.push({ cmd, args });
  }
  return result;
}

/** Evaluate a cubic Bézier at parameter t ∈ [0,1]. */
function cubicAt(seg: CubicSegment, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * seg.p0.x + 3 * uu * t * seg.p1.x + 3 * u * tt * seg.p2.x + ttt * seg.p3.x,
    y: uuu * seg.p0.y + 3 * uu * t * seg.p1.y + 3 * u * tt * seg.p2.y + ttt * seg.p3.y,
  };
}

/** Evaluate a quadratic Bézier at parameter t ∈ [0,1]. */
function quadAt(seg: QuadSegment, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * seg.p0.x + 2 * u * t * seg.p1.x + t * t * seg.p2.x,
    y: u * u * seg.p0.y + 2 * u * t * seg.p1.y + t * t * seg.p2.y,
  };
}

/** Sample N evenly-spaced points along a cubic Bézier (excluding t=0). */
function sampleCubic(seg: CubicSegment, n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= n; i++) {
    pts.push(cubicAt(seg, i / n));
  }
  return pts;
}

/** Sample N evenly-spaced points along a quadratic Bézier (excluding t=0). */
function sampleQuad(seg: QuadSegment, n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= n; i++) {
    pts.push(quadAt(seg, i / n));
  }
  return pts;
}

/** Number of sample points per Bézier segment. */
const SAMPLES_PER_SEGMENT = 5;

/**
 * Parse an SVG path d-attribute and return sampled points along all strokes.
 * Handles M, L, C, S, Q, Z commands (both absolute and relative).
 */
export function samplePathPoints(d: string): Point[] {
  const tokens = tokenize(d);
  const points: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastControl: Point | null = null; // for S (smooth cubic) reflection

  for (const { cmd, args } of tokens) {
    const isRelative = cmd === cmd.toLowerCase();
    const CMD = cmd.toUpperCase();

    switch (CMD) {
      case "M": {
        // MoveTo — can have implicit LineTo args after first pair
        for (let i = 0; i < args.length; i += 2) {
          const x = isRelative ? cur.x + args[i] : args[i];
          const y = isRelative ? cur.y + args[i + 1] : args[i + 1];
          if (i === 0) {
            cur = { x, y };
            start = { x, y };
            points.push({ ...cur });
          } else {
            // Implicit LineTo
            const prev = cur;
            cur = { x, y };
            // Sample line as 2 points
            points.push({ x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 });
            points.push({ ...cur });
          }
        }
        lastControl = null;
        break;
      }

      case "L": {
        for (let i = 0; i < args.length; i += 2) {
          const x = isRelative ? cur.x + args[i] : args[i];
          const y = isRelative ? cur.y + args[i + 1] : args[i + 1];
          const prev = cur;
          cur = { x, y };
          points.push({ x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 });
          points.push({ ...cur });
        }
        lastControl = null;
        break;
      }

      case "C": {
        // Cubic Bézier: C x1 y1, x2 y2, x y (6 args per segment)
        for (let i = 0; i + 5 < args.length; i += 6) {
          const p1x = isRelative ? cur.x + args[i] : args[i];
          const p1y = isRelative ? cur.y + args[i + 1] : args[i + 1];
          const p2x = isRelative ? cur.x + args[i + 2] : args[i + 2];
          const p2y = isRelative ? cur.y + args[i + 3] : args[i + 3];
          const px = isRelative ? cur.x + args[i + 4] : args[i + 4];
          const py = isRelative ? cur.y + args[i + 5] : args[i + 5];

          const seg: CubicSegment = {
            p0: cur,
            p1: { x: p1x, y: p1y },
            p2: { x: p2x, y: p2y },
            p3: { x: px, y: py },
          };
          points.push(...sampleCubic(seg, SAMPLES_PER_SEGMENT));
          lastControl = { x: p2x, y: p2y };
          cur = { x: px, y: py };
        }
        break;
      }

      case "S": {
        // Smooth cubic: S x2 y2, x y (4 args per segment)
        for (let i = 0; i + 3 < args.length; i += 4) {
          // Reflect previous control point
          const p1: Point = lastControl
            ? { x: 2 * cur.x - lastControl.x, y: 2 * cur.y - lastControl.y }
            : cur;
          const p2x = isRelative ? cur.x + args[i] : args[i];
          const p2y = isRelative ? cur.y + args[i + 1] : args[i + 1];
          const px = isRelative ? cur.x + args[i + 2] : args[i + 2];
          const py = isRelative ? cur.y + args[i + 3] : args[i + 3];

          const seg: CubicSegment = {
            p0: cur,
            p1: p1,
            p2: { x: p2x, y: p2y },
            p3: { x: px, y: py },
          };
          points.push(...sampleCubic(seg, SAMPLES_PER_SEGMENT));
          lastControl = { x: p2x, y: p2y };
          cur = { x: px, y: py };
        }
        break;
      }

      case "Q": {
        // Quadratic Bézier: Q x1 y1, x y (4 args per segment)
        for (let i = 0; i + 3 < args.length; i += 4) {
          const p1x = isRelative ? cur.x + args[i] : args[i];
          const p1y = isRelative ? cur.y + args[i + 1] : args[i + 1];
          const px = isRelative ? cur.x + args[i + 2] : args[i + 2];
          const py = isRelative ? cur.y + args[i + 3] : args[i + 3];

          const seg: QuadSegment = {
            p0: cur,
            p1: { x: p1x, y: p1y },
            p2: { x: px, y: py },
          };
          points.push(...sampleQuad(seg, SAMPLES_PER_SEGMENT));
          lastControl = { x: p1x, y: p1y };
          cur = { x: px, y: py };
        }
        break;
      }

      case "Z": {
        cur = { ...start };
        lastControl = null;
        break;
      }
    }
  }

  return points;
}

/**
 * Bin sampled points into a grid and return a density vector.
 * Each cell contains the count of points landing in it, normalized to 0-1.
 *
 * @param points - Sampled points from SVG path(s)
 * @param gridSize - Grid dimension (e.g. 16 → 16x16 = 256 cells)
 * @param canvasSize - The coordinate space size (KanjiVG uses 109x109)
 * @returns Float32Array of length gridSize*gridSize, values 0-1
 */
export function buildGridVector(
  points: Point[],
  gridSize: number = 16,
  canvasSize: number = 109,
): Float32Array {
  const cells = gridSize * gridSize;
  const grid = new Float32Array(cells);

  for (const p of points) {
    const col = Math.min(Math.floor((p.x / canvasSize) * gridSize), gridSize - 1);
    const row = Math.min(Math.floor((p.y / canvasSize) * gridSize), gridSize - 1);
    if (col >= 0 && row >= 0) {
      grid[row * gridSize + col]++;
    }
  }

  // Normalize to 0-1
  let maxVal = 0;
  for (let i = 0; i < cells; i++) {
    if (grid[i] > maxVal) maxVal = grid[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < cells; i++) {
      grid[i] /= maxVal;
    }
  }

  return grid;
}

/** L2-normalize a vector in place. Returns the same array. */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

/** Cosine similarity between two vectors (assumes both are L2-normalized → dot product). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
