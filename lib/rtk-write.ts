/**
 * Writing a frame from its keyword. The grading is the learner's own — matching
 * a finger stroke against KanjiVG is a project of its own, and recognising that
 * you could not write it is the exercise the book actually sets.
 */

/** KanjiVG's box, the one `components/StrokeOrderDiagram.tsx` already draws in. */
export const STROKE_BOX = 109;

export interface Point {
  x: number;
  y: number;
}

/** A finger stroke as an SVG path, in the same box as the real strokes. */
export function strokePath(points: readonly Point[]): string {
  const round = (n: number) => Math.round(Math.max(0, Math.min(STROKE_BOX, n)) * 10) / 10;
  const inside = points.map(({ x, y }) => ({ x: round(x), y: round(y) }));

  // Rounded first, then de-duplicated: 1.01 and 1.02 are the same tenth, and
  // keeping both would emit the same L twice.
  const kept = inside.filter(
    (point, i) => i === 0 || point.x !== inside[i - 1].x || point.y !== inside[i - 1].y,
  );
  if (kept.length === 0) return "";

  const [first, ...rest] = kept;
  // A tap is a dot: a lone moveto draws nothing at all.
  if (rest.length === 0) return `M${first.x},${first.y}l0,0`;
  return `M${first.x},${first.y}` + rest.map((point) => `L${point.x},${point.y}`).join("");
}

export type WriteGrade = "missed" | "close" | "got-it";

export const WRITE_GRADES: readonly WriteGrade[] = ["missed", "close", "got-it"];

/**
 * What a grade means for the queue. "Close" counts as a hit: the learner
 * produced the frame, and asking again inside the same session would be testing
 * the hand rather than the memory.
 */
export function gradeOutcome(grade: WriteGrade): "hit" | "miss" {
  return grade === "missed" ? "miss" : "hit";
}

export function gradeLabel(grade: WriteGrade): string {
  switch (grade) {
    case "missed":
      return "Could not";
    case "close":
      return "Close";
    case "got-it":
      return "Got it";
  }
}
