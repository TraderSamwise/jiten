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
    expect(pool.length).toBeGreaterThan(0);
    const c = buildPrimitiveChoices(pool[0], 4, idRng);
    expect(c).toHaveLength(4);
    expect(c.filter((x) => x.correct)).toHaveLength(1);
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
