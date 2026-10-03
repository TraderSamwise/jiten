import { describe, it, expect } from "vitest";

import {
  COURSE_RTK,
  CROWN_MAX,
  NODE_SIZE,
  PATH_FRAME_COUNT,
  PATH_UNIT_COUNT,
  introducible,
  isCracked,
  isPathFrame,
  nextCrown,
  nextNode,
  nodeId,
  nodesInUnit,
  parseNodeId,
  splitUnitIntoNodes,
  stepsForCrown,
  unitCrownTotal,
  unitsFromFrames,
  type CourseFrame,
  type NodeCrowns,
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

describe("what is on the path", () => {
  it("drops a frame the dictionary gives no lesson", () => {
    // Frames 2201-3000 are keyworded but lesson-less; they have no unit.
    const mixed = [...frames(5, 1), ...frames(3, null, 2201)];
    expect(mixed.filter(isPathFrame)).toHaveLength(5);
    expect(unitsFromFrames(mixed)).toEqual([{ unit: 1, nodeCount: 1 }]);
  });

  it("builds one unit shape per lesson, lowest first", () => {
    const mixed = [...frames(6, 9), ...frames(15, 2, 100)];
    expect(unitsFromFrames(mixed)).toEqual([
      { unit: 2, nodeCount: 3 },
      { unit: 9, nodeCount: 2 },
    ]);
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

    let index = 1;
    const vol1: CourseFrame[] = [];
    perLesson.forEach((count, i) => {
      for (let n = 0; n < count; n++, index++) {
        vol1.push({ literal: `k${index}`, index, keyword: `kw${index}`, lesson: i + 1 });
      }
    });

    const units = unitsFromFrames(vol1);
    expect(units).toHaveLength(PATH_UNIT_COUNT);
    expect(units.map((u) => u.unit)).toEqual(perLesson.map((_, i) => i + 1));
    expect(units.reduce((n, u) => n + u.nodeCount, 0)).toBe(461);
    // The 142-frame lesson is the one that proves a short tail survives.
    expect(units[22].nodeCount).toBe(nodesInUnit(142));
    expect(splitUnitIntoNodes(vol1.filter((f) => f.lesson === 23)).at(-1)).toHaveLength(2);
  });

  it("has no units at all when nothing has a lesson", () => {
    expect(unitsFromFrames(frames(4, null, 2500))).toEqual([]);
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

describe("unit totals", () => {
  it("sums the crowns its nodes have earned", () => {
    const crowns = crownsFrom({ "rtk:1:0": 3, "rtk:1:1": 1 });
    expect(unitCrownTotal({ unit: 1, nodeCount: 3 }, crowns)).toBe(4);
  });

  it("never counts more than the cap for one node", () => {
    const crowns = crownsFrom({ "rtk:1:0": 99 });
    expect(unitCrownTotal({ unit: 1, nodeCount: 1 }, crowns)).toBe(CROWN_MAX);
  });
});
