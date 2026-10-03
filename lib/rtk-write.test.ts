import { describe, expect, it } from "vitest";

import { gradeLabel, gradeOutcome, strokePath, STROKE_BOX, WRITE_GRADES } from "./rtk-write";

describe("a finger stroke as a path", () => {
  it("draws a line through the points", () => {
    expect(
      strokePath([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ]),
    ).toBe("M10,20L30,40L50,60");
  });

  it("draws a tap as a dot, not as nothing", () => {
    // A lone moveto paints no pixels at all.
    expect(strokePath([{ x: 5, y: 6 }])).toBe("M5,6l0,0");
  });

  it("has nothing to draw for no points", () => {
    expect(strokePath([])).toBe("");
  });

  it("drops a point the finger did not move from", () => {
    expect(
      strokePath([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe("M1,1L2,2");
  });

  it("keeps the stroke inside the box the real strokes are drawn in", () => {
    const path = strokePath([
      { x: -40, y: 200 },
      { x: 500, y: -3 },
    ]);
    expect(path).toBe(`M0,${STROKE_BOX}L${STROKE_BOX},0`);
  });

  it("rounds to a tenth, so a long stroke is not a long string", () => {
    expect(strokePath([{ x: 1.23456, y: 9.87654 }])).toBe("M1.2,9.9l0,0");
  });

  it("rounds before de-duplicating, so one tenth is one point", () => {
    expect(
      strokePath([
        { x: 1.01, y: 1.01 },
        { x: 1.02, y: 1.02 },
        { x: 5, y: 5 },
      ]),
    ).toBe("M1,1L5,5");
  });
});

describe("the learner's own grade", () => {
  it("offers three", () => {
    expect(WRITE_GRADES).toEqual(["missed", "close", "got-it"]);
    expect(WRITE_GRADES.map(gradeLabel)).toEqual(["Could not", "Close", "Got it"]);
  });

  it("counts close as produced", () => {
    // Asking again in the same sitting would test the hand, not the memory.
    expect(gradeOutcome("close")).toBe("hit");
    expect(gradeOutcome("got-it")).toBe("hit");
  });

  it("counts only a blank as a miss", () => {
    expect(gradeOutcome("missed")).toBe("miss");
  });
});
