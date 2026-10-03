import { describe, expect, it } from "vitest";

import { buildChoices, pickDistractors } from "./rtk-distractors";
import type { CourseFrame } from "./rtk-course";

function frame(literal: string, index: number, keyword = `kw-${literal}`): CourseFrame {
  return { literal, index, keyword, lesson: 1 };
}

const answer = frame("日", 12);

describe("choosing the wrong answers", () => {
  it("takes the lookalikes first, in order", () => {
    const similar = [frame("目", 15), frame("白", 37), frame("田", 14)];
    const picked = pickDistractors({ answer, similar, unit: [], count: 3 });
    expect(picked.map((f) => f.literal)).toEqual(["目", "白", "田"]);
  });

  it("never offers the answer as a wrong answer", () => {
    const similar = [frame("日", 12), frame("目", 15)];
    const picked = pickDistractors({ answer, similar, unit: [], count: 2 });
    expect(picked.map((f) => f.literal)).toEqual(["目"]);
  });

  it("never offers the same frame twice", () => {
    const similar = [frame("目", 15), frame("目", 15)];
    const unit = [frame("目", 15)];
    const picked = pickDistractors({ answer, similar, unit, count: 3 });
    expect(picked).toHaveLength(1);
  });

  it("tops up from the unit when the lookalikes run out", () => {
    // 7 of the 2,200 frames have no lookalike that is itself a frame.
    const unit = [answer, frame("一", 1), frame("二", 2), frame("三", 3)];
    const picked = pickDistractors({ answer, similar: [], unit, count: 3 });
    expect(picked).toHaveLength(3);
    expect(picked.map((f) => f.literal)).not.toContain("日");
  });

  it("tops up with the frames met around the same time", () => {
    const unit = [frame("近", 11), frame("遠", 300), frame("次", 13)];
    const picked = pickDistractors({ answer, similar: [], unit, count: 2 });
    expect(picked.map((f) => f.literal)).toEqual(["近", "次"]);
  });

  it("returns fewer rather than padding with nothing useful", () => {
    const picked = pickDistractors({ answer, similar: [], unit: [answer], count: 3 });
    expect(picked).toEqual([]);
  });

  it("skips a frame with no keyword to show", () => {
    const similar = [frame("目", 15, ""), frame("白", 37)];
    const picked = pickDistractors({ answer, similar, unit: [], count: 2 });
    expect(picked.map((f) => f.literal)).toEqual(["白"]);
  });

  it("asks for none when none are wanted", () => {
    expect(pickDistractors({ answer, similar: [frame("目", 15)], unit: [], count: 0 })).toEqual([]);
  });
});

describe("the options as shown", () => {
  const similar = [frame("目", 15), frame("白", 37), frame("田", 14)];

  it("always includes the answer exactly once", () => {
    for (let seed = 0; seed < 20; seed++) {
      const choices = buildChoices({ answer, similar, unit: [], count: 3 }, seed);
      expect(choices.filter((c) => c.correct)).toHaveLength(1);
      expect(choices).toHaveLength(4);
    }
  });

  it("does not always put the answer in the same place", () => {
    const positions = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        buildChoices({ answer, similar, unit: [], count: 3 }, seed).findIndex((c) => c.correct),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it("arranges the same way for the same seed", () => {
    const a = buildChoices({ answer, similar, unit: [], count: 3 }, 7);
    const b = buildChoices({ answer, similar, unit: [], count: 3 }, 7);
    expect(a.map((c) => c.frame.literal)).toEqual(b.map((c) => c.frame.literal));
  });

  it("still offers the answer when there are no distractors at all", () => {
    const choices = buildChoices({ answer, similar: [], unit: [], count: 3 }, 1);
    expect(choices).toEqual([{ frame: answer, correct: true }]);
  });
});
