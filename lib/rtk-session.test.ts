import { describe, expect, it } from "vitest";

import { CROWN_MAX, type CourseFrame } from "./rtk-course";
import {
  advance,
  currentItem,
  dropStep,
  isComplete,
  skipCurrent,
  startSession,
} from "./rtk-session";

const FRAMES: CourseFrame[] = ["一", "二", "三", "四", "五"].map((literal, i) => ({
  literal,
  index: i + 1,
  keyword: ["one", "two", "three", "four", "five"][i],
  lesson: 1,
}));

function stepsOf(state: { queue: readonly { step: string }[] }) {
  return state.queue.map((item) => item.step);
}

describe("a first pass over a node", () => {
  const session = startSession(FRAMES, 0);

  it("meets all five frames before drilling any", () => {
    expect(stepsOf(session).slice(0, 5)).toEqual(Array(5).fill("meet"));
    expect(
      session.queue
        .slice(0, 5)
        .map((i) => i.frame.literal)
        .join(""),
    ).toBe("一二三四五");
  });

  it("tests every frame once before any frame twice", () => {
    const afterMeets = stepsOf(session).slice(5);
    expect(afterMeets.slice(0, 5)).toEqual(Array(5).fill("recognise"));
    expect(afterMeets.slice(5, 10)).toEqual(Array(5).fill("identify"));
  });

  it("asks four things of each of five frames", () => {
    expect(session.queue).toHaveLength(20);
    expect(session.cleared).toHaveLength(0);
    expect(session.skipped).toHaveLength(0);
  });

  it("starts on the first frame's meet step", () => {
    expect(currentItem(session)).toMatchObject({ step: "meet", frame: { literal: "一" } });
  });
});

describe("answering", () => {
  it("clears an item on a hit", () => {
    const after = advance(startSession(FRAMES, 0), "hit");
    expect(after.queue).toHaveLength(19);
    expect(after.cleared).toHaveLength(1);
    expect(after.misses).toBe(0);
    expect(currentItem(after)?.frame.literal).toBe("二");
  });

  it("brings a missed item back later in the same session, not at once", () => {
    const start = startSession(FRAMES, 1);
    const missed = currentItem(start)!;
    const after = advance(start, "miss");
    expect(after.queue).toHaveLength(start.queue.length);
    expect(after.misses).toBe(1);
    expect(currentItem(after)).not.toEqual(missed);
    expect(after.queue[2]).toEqual(missed);
  });

  it("puts a miss at the end when there is nothing left to space it against", () => {
    let state = startSession([FRAMES[0]], 1);
    while (state.queue.length > 1) state = advance(state, "hit");
    const last = currentItem(state)!;
    const after = advance(state, "miss");
    expect(after.queue).toEqual([last]);
  });

  it("finishes when the queue empties", () => {
    let state = startSession(FRAMES, 0);
    for (let i = 0; i < 20; i++) state = advance(state, "hit");
    expect(isComplete(state)).toBe(true);
    expect(state.cleared).toHaveLength(20);
  });

  it("does nothing once it is complete", () => {
    const empty = startSession(FRAMES, CROWN_MAX);
    expect(isComplete(empty)).toBe(true);
    expect(advance(empty, "hit")).toEqual(empty);
    expect(skipCurrent(empty)).toEqual(empty);
  });
});

describe("skipping", () => {
  it("drops one item without counting it either way", () => {
    const after = skipCurrent(startSession(FRAMES, 0));
    expect(after.cleared).toHaveLength(0);
    expect(after.skipped).toHaveLength(1);
    expect(after.misses).toBe(0);
    expect(after.queue).toHaveLength(19);
  });

  it("drops every cloze step of a node with no stories", () => {
    const after = dropStep(startSession(FRAMES, 0), "cloze");
    expect(after.queue).toHaveLength(15);
    expect(stepsOf(after)).not.toContain("cloze");
    expect(after.skipped).toHaveLength(5);
  });

  it("leaves out a step the runner cannot render yet", () => {
    // A phase that only implements Meet runs a coherent session whose progress
    // bar counts five items, not twenty with fifteen pre-skipped.
    const state = startSession(FRAMES, 0, ["meet"]);
    expect(stepsOf(state)).toEqual(Array(5).fill("meet"));
    expect(state.queue).toHaveLength(5);
    expect(state.skipped).toHaveLength(0);
  });

  it("leaves a session alone when the step is not in it", () => {
    const start = startSession(FRAMES, 0);
    expect(dropStep(start, "write")).toEqual(start);
  });
});

describe("later passes", () => {
  it("adds assemble at the second crown and drops meet", () => {
    const steps = new Set(stepsOf(startSession(FRAMES, 1)));
    expect(steps.has("assemble")).toBe(true);
    expect(steps.has("meet")).toBe(false);
  });

  it("adds write at the third", () => {
    expect(new Set(stepsOf(startSession(FRAMES, 2)))).toContain("write");
  });

  it("has nothing to ask of a node already at the cap", () => {
    expect(startSession(FRAMES, CROWN_MAX).queue).toEqual([]);
  });
});
