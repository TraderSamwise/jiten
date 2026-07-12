import { describe, expect, it } from "vitest";
import { buildPrimitiveChoices, forgePool, type ShuffleRng } from "./forge";
import { loadStubCorpus } from "./corpus";
import { radialIndexAt } from "./wheel";

// Deterministic identity "shuffle" so choice contents are assertable.
const idRng: ShuffleRng = { shuffle: <T>(a: T[]): T[] => a };

describe("buildPrimitiveChoices", () => {
  it("includes the correct keyword exactly once and fills to count", () => {
    const c = buildPrimitiveChoices("sun", 5, idRng);
    expect(c).toHaveLength(5);
    expect(c.filter((x) => x.correct)).toHaveLength(1);
    expect(c.find((x) => x.correct)?.keyword).toBe("sun");
    expect(c.filter((x) => !x.correct).every((x) => x.keyword !== "sun")).toBe(true);
  });

  it("draws decoys from the loaded corpus when available", () => {
    loadStubCorpus();
    const pool = forgePool();
    expect(pool.length).toBeGreaterThanOrEqual(4);
    const c = buildPrimitiveChoices(pool[0], 4, idRng);
    expect(c).toHaveLength(4);
    expect(c.filter((x) => x.correct)).toHaveLength(1);
    // With a corpus this size the decoys should come from it, not the fallback.
    expect(c.filter((x) => !x.correct).every((x) => pool.includes(x.keyword))).toBe(true);
  });

  it("is deterministic for a given rng — same layout across reads", () => {
    // A non-identity but deterministic shuffle, so this pins that shuffle is
    // actually applied AND that the result is stable across calls (the property
    // the per-primitive seed relies on for a fixed layout).
    const revRng: ShuffleRng = { shuffle: <T>(a: T[]): T[] => [...a].reverse() };
    const a = buildPrimitiveChoices("sun", 5, revRng).map((x) => x.keyword);
    const b = buildPrimitiveChoices("sun", 5, revRng).map((x) => x.keyword);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe("sun"); // shuffle moved the correct off the insertion slot
  });
});

describe("radialIndexAt", () => {
  it("returns null inside the deadzone", () => {
    expect(radialIndexAt(100, 100, 102, 102, 80, 0.2, 16)).toBeNull();
  });

  it("selects the top slot for a pointer straight up", () => {
    expect(radialIndexAt(100, 100, 100, 20, 80, 0.2, 16)).toBe(0);
  });
});
