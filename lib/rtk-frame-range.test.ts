/**
 * Which frames a node covers. A tile says "16–20", so the number has to be the
 * frames the node really asks about — and where it cannot be known, the tile
 * says nothing rather than something wrong.
 */
import { describe, expect, it } from "vitest";

import { formatFrameRange, nodeFrameRange, unitSpan, type FrameSpan } from "./rtk-course";

/** Lesson 2 of the real course: 19 frames, 16 through 34, four nodes. */
const LESSON_2 = unitSpan(19, 16);

describe("the frames a node covers", () => {
  it("starts where the unit starts", () => {
    expect(nodeFrameRange(LESSON_2, 0)).toEqual({ from: 16, to: 20 });
  });

  it("walks five at a time", () => {
    expect(nodeFrameRange(LESSON_2, 1)).toEqual({ from: 21, to: 25 });
    expect(nodeFrameRange(LESSON_2, 2)).toEqual({ from: 26, to: 30 });
  });

  it("stops at the unit's last frame, however short the node", () => {
    // 19 frames over four nodes: the last holds four, not five.
    expect(nodeFrameRange(LESSON_2, 3)).toEqual({ from: 31, to: 34 });
  });

  it("knows a node the unit does not have", () => {
    expect(nodeFrameRange(LESSON_2, 4)).toBeNull();
    expect(nodeFrameRange(LESSON_2, -1)).toBeNull();
  });

  it("refuses a node index that is not one", () => {
    expect(nodeFrameRange(LESSON_2, 1.5)).toBeNull();
    expect(nodeFrameRange(LESSON_2, NaN)).toBeNull();
  });

  it("stops at the last frame even when the node count overshoots it", () => {
    // Each guard on its own: this span claims four nodes over ten frames, so
    // only the last check keeps node 2 from naming frames that do not exist.
    const overshoot: FrameSpan = { frames: 10, firstFrame: 1, lastFrame: 10, nodeCount: 4 };
    expect(nodeFrameRange(overshoot, 1)).toEqual({ from: 6, to: 10 });
    expect(nodeFrameRange(overshoot, 2)).toBeNull();
  });

  it("has nothing to say about a unit with no frames", () => {
    expect(nodeFrameRange(unitSpan(0, 1), 0)).toBeNull();
  });

  it("says nothing rather than guessing when the frames are not one run", () => {
    // 10 frames but a span of 20: the arithmetic below "frame 5 is the fifth"
    // does not hold, so a label would be a lie. Every shipped lesson is one
    // unbroken run — this is what happens if one ever is not.
    const gapped: FrameSpan = { frames: 10, firstFrame: 1, lastFrame: 20, nodeCount: 2 };
    expect(nodeFrameRange(gapped, 0)).toBeNull();
  });

  it("derives the node count from the frames, so a fixture cannot disagree", () => {
    expect(unitSpan(15, 1)).toEqual({ frames: 15, firstFrame: 1, lastFrame: 15, nodeCount: 3 });
    expect(unitSpan(16, 1).nodeCount).toBe(4);
    expect(unitSpan(0, 1)).toEqual({ frames: 0, firstFrame: 1, lastFrame: 0, nodeCount: 0 });
  });
});

describe("writing a range on a tile", () => {
  it("reads as a range", () => {
    expect(formatFrameRange({ from: 16, to: 20 })).toBe("16–20");
  });

  it("drops the dash for a node holding one frame", () => {
    expect(formatFrameRange({ from: 15, to: 15 })).toBe("15");
  });

  it("has nothing to write when there is no range", () => {
    expect(formatFrameRange(null)).toBeNull();
  });
});
