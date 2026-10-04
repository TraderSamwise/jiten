import { describe, it, expect } from "vitest";

import {
  COURSE_RTK,
  CROWN_MAX,
  NODE_SIZE,
  introducible,
  isCracked,
  isPathFrame,
  nextCrown,
  nextNode,
  nodeId,
  nodeRefFromParams,
  nodesInUnit,
  parseNodeId,
  splitUnitIntoNodes,
  stepsForCrown,
  pathSummary,
  type CourseFrame,
  type NodeCrowns,
  RTK_PATH_FRAME_COUNT,
} from "./rtk-course";

function frames(count: number, lesson: number | null = 1, startIndex = 1): CourseFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    literal: String.fromCodePoint(0x4e00 + i),
    index: startIndex + i,
    keyword: `kw${startIndex + i}`,
    lesson,
  }));
}

function crownsFrom(map: Record<string, number>): NodeCrowns {
  return { crownOf: (id) => map[id] ?? 0 };
}

describe("node ids", () => {
  it("round-trips", () => {
    const ref = { course: COURSE_RTK, unit: 12, node: 3 };
    expect(nodeId(ref)).toBe("rtk:12:3");
    expect(parseNodeId("rtk:12:3")).toEqual(ref);
  });

  it("rejects anything that is not one", () => {
    for (const bad of ["rtk:12", "rtk:12:3:4", "RTK:1:2", "rtk:a:b", "", ":1:2", "rtk:-1:2"]) {
      expect(parseNodeId(bad)).toBeNull();
    }
  });
});

describe("node boundaries", () => {
  it("counts nodes per unit", () => {
    expect(nodesInUnit(0)).toBe(0);
    expect(nodesInUnit(1)).toBe(1);
    expect(nodesInUnit(NODE_SIZE)).toBe(1);
    expect(nodesInUnit(NODE_SIZE + 1)).toBe(2);
    // RTK lesson 1 has 15 frames; the largest lesson has 142.
    expect(nodesInUnit(15)).toBe(3);
    expect(nodesInUnit(142)).toBe(29);
  });

  it("splits a 15-frame unit into three full nodes", () => {
    const nodes = splitUnitIntoNodes(frames(15));
    expect(nodes.map((n) => n.length)).toEqual([5, 5, 5]);
    expect(nodes[0][0].index).toBe(1);
    expect(nodes[2][4].index).toBe(15);
  });

  it("leaves the last node of the largest unit short", () => {
    const nodes = splitUnitIntoNodes(frames(142));
    expect(nodes).toHaveLength(29);
    expect(nodes[28]).toHaveLength(2);
  });

  it("orders by frame number, not by input order", () => {
    const shuffled = [...frames(6)].reverse();
    const nodes = splitUnitIntoNodes(shuffled);
    expect(nodes[0].map((f) => f.index)).toEqual([1, 2, 3, 4, 5]);
    expect(nodes[1].map((f) => f.index)).toEqual([6]);
  });

  it("has no nodes for an empty unit", () => {
    expect(splitUnitIntoNodes([])).toEqual([]);
  });
});

// Volume 1, the whole of the path, as assets/dictionary.db holds it.
const PATH_FRAME_COUNT = RTK_PATH_FRAME_COUNT;
const PATH_UNIT_COUNT = 56;

describe("what is on the path", () => {
  it("drops a frame the dictionary gives no lesson", () => {
    // Frames 2201-3000 are keyworded but lesson-less; they have no unit.
    const mixed = [...frames(5, 1), ...frames(3, null, 2201)];
    expect(mixed.filter(isPathFrame)).toHaveLength(5);
    expect(splitUnitIntoNodes(mixed).flat()).toHaveLength(5);
  });

  it("covers volume 1 as the dictionary actually divides it", () => {
    // Frames per lesson from assets/dictionary.db — lessons run 6 to 142 frames,
    // so a uniform fixture would not exercise the ragged tails.
    const perLesson = [
      15, 19, 20, 20, 24, 11, 24, 51, 22, 43, 15, 30, 26, 25, 31, 19, 27, 92, 33, 6, 66, 67, 142,
      30, 99, 65, 81, 20, 43, 39, 62, 37, 32, 53, 41, 66, 37, 62, 55, 60, 32, 34, 36, 33, 48, 20,
      32, 24, 27, 28, 28, 24, 55, 30, 20, 19,
    ];
    expect(perLesson).toHaveLength(PATH_UNIT_COUNT);
    expect(perLesson.reduce((a, b) => a + b, 0)).toBe(PATH_FRAME_COUNT);

    // What db/rtk-frames.ts loadUnitShapes does with the same counts.
    const nodeTotal = perLesson.reduce((n, count) => n + nodesInUnit(count), 0);
    expect(nodeTotal).toBe(461);

    // The 142-frame lesson is the one that proves a short tail survives.
    expect(nodesInUnit(142)).toBe(29);
    expect(splitUnitIntoNodes(frames(142, 23)).at(-1)).toHaveLength(2);
  });

  it("has no nodes at all when nothing has a lesson", () => {
    expect(splitUnitIntoNodes(frames(4, null, 2500))).toEqual([]);
  });
});

describe("crowns", () => {
  it("escalates the exercises each pass", () => {
    expect(stepsForCrown(0)).toContain("meet");
    expect(stepsForCrown(0)).not.toContain("assemble");
    expect(stepsForCrown(1)).toContain("assemble");
    expect(stepsForCrown(1)).not.toContain("meet");
    expect(stepsForCrown(2)).toContain("write");
    expect(stepsForCrown(2)).not.toContain("recognise");
  });

  it("runs cloze on every pass", () => {
    for (const crown of [0, 1, 2]) expect(stepsForCrown(crown)).toContain("cloze");
  });

  it("has nothing left to run at the cap", () => {
    expect(stepsForCrown(CROWN_MAX)).toEqual([]);
    expect(stepsForCrown(99)).toEqual([]);
  });

  it("caps at the maximum", () => {
    expect(nextCrown(0)).toBe(1);
    expect(nextCrown(CROWN_MAX)).toBe(CROWN_MAX);
  });

  it("counts a node cracked from its first crown", () => {
    expect(isCracked(0)).toBe(false);
    expect(isCracked(1)).toBe(true);
  });
});

describe("the primitive gate", () => {
  const known = new Set(["日", "月"]);

  it("admits a frame whose kanji parts are known", () => {
    expect(introducible([{ glyph: "日", isPrimitive: false }], known)).toBe(true);
  });

  it("holds back a frame built on an unknown kanji", () => {
    expect(introducible([{ glyph: "田", isPrimitive: false }], known)).toBe(false);
  });

  it("never gates on an invented primitive", () => {
    expect(introducible([{ glyph: null, isPrimitive: true }], known)).toBe(true);
    expect(introducible([{ glyph: "宀", isPrimitive: true }], known)).toBe(true);
  });

  it("admits a frame with no components at all", () => {
    expect(introducible([], known)).toBe(true);
  });
});

describe("what Continue resolves to", () => {
  const units = [
    { unit: 1, nodeCount: 3 },
    { unit: 2, nodeCount: 2 },
  ];

  it("starts at the first node", () => {
    expect(nextNode(units, crownsFrom({}))).toEqual({ course: COURSE_RTK, unit: 1, node: 0 });
  });

  it("skips nodes already at the cap", () => {
    const crowns = crownsFrom({ "rtk:1:0": 3, "rtk:1:1": 3 });
    expect(nextNode(units, crowns)).toEqual({ course: COURSE_RTK, unit: 1, node: 2 });
  });

  it("returns a partly-crowned node before an untouched later one", () => {
    const crowns = crownsFrom({ "rtk:1:0": 3, "rtk:1:1": 1 });
    expect(nextNode(units, crowns)).toEqual({ course: COURSE_RTK, unit: 1, node: 1 });
  });

  it("crosses into the next unit", () => {
    const crowns = crownsFrom({ "rtk:1:0": 3, "rtk:1:1": 3, "rtk:1:2": 3 });
    expect(nextNode(units, crowns)).toEqual({ course: COURSE_RTK, unit: 2, node: 0 });
  });

  it("orders by unit number, not array order", () => {
    const outOfOrder = [
      { unit: 9, nodeCount: 1 },
      { unit: 4, nodeCount: 1 },
    ];
    expect(nextNode(outOfOrder, crownsFrom({}))?.unit).toBe(4);
  });

  it("is null when the course is finished", () => {
    const crowns = crownsFrom({
      "rtk:1:0": 3,
      "rtk:1:1": 3,
      "rtk:1:2": 3,
      "rtk:2:0": 3,
      "rtk:2:1": 3,
    });
    expect(nextNode(units, crowns)).toBeNull();
  });

  it("skips a unit with no frames", () => {
    expect(nextNode([{ unit: 1, nodeCount: 0 }, units[1]], crownsFrom({}))).toEqual({
      course: COURSE_RTK,
      unit: 2,
      node: 0,
    });
  });
});

describe("what the path draws", () => {
  const units = [
    { unit: 1, nodeCount: 3 },
    { unit: 2, nodeCount: 2 },
  ];

  it("gives every node a dot, in node order", () => {
    const summary = pathSummary(units, crownsFrom({ "rtk:1:0": 3, "rtk:1:2": 1 }));
    expect(summary.rows.map((r) => r.crowns)).toEqual([
      [3, 0, 1],
      [0, 0],
    ]);
  });

  it("totals what is earned against what there is to earn", () => {
    const summary = pathSummary(units, crownsFrom({ "rtk:1:0": 3, "rtk:2:1": 2 }));
    expect(summary.rows[0]).toMatchObject({ unit: 1, earned: 3, possible: 9 });
    expect(summary.earned).toBe(5);
    expect(summary.possible).toBe(15);
  });

  it("carries where Continue goes", () => {
    expect(pathSummary(units, crownsFrom({})).next).toEqual({
      course: COURSE_RTK,
      unit: 1,
      node: 0,
    });
  });

  it("has no next node once every one is capped", () => {
    const all = crownsFrom({
      "rtk:1:0": 3,
      "rtk:1:1": 3,
      "rtk:1:2": 3,
      "rtk:2:0": 3,
      "rtk:2:1": 3,
    });
    const summary = pathSummary(units, all);
    expect(summary.next).toBeNull();
    expect(summary.earned).toBe(summary.possible);
  });

  it("draws a unit with no frames as no dots at all", () => {
    const summary = pathSummary([{ unit: 1, nodeCount: 0 }], crownsFrom({}));
    expect(summary.rows[0]).toMatchObject({ crowns: [], earned: 0, possible: 0 });
  });

  it("never lets a junk crown distort a total", () => {
    const summary = pathSummary([{ unit: 1, nodeCount: 2 }], crownsFrom({ "rtk:1:0": -5 }));
    expect(summary.rows[0].earned).toBe(0);
  });
});

describe("a node from a link", () => {
  it("reads the query the path writes", () => {
    expect(nodeRefFromParams("12", "3")).toEqual({ course: COURSE_RTK, unit: 12, node: 3 });
    expect(nodeRefFromParams("1", "0")).toEqual({ course: COURSE_RTK, unit: 1, node: 0 });
  });

  it("refuses anything that is not one", () => {
    for (const [unit, node] of [
      ["abc", "0"],
      ["1", "x"],
      ["-1", "0"],
      ["1", "-2"],
      ["1.5", "0"],
      ["1", ""],
      [undefined, undefined],
    ] as [string | undefined, string | undefined][]) {
      expect(nodeRefFromParams(unit, node)).toBeNull();
    }
  });
});
