import { describe, expect, it } from "vitest";

import { bookmarkSetVersion } from "./bookmark-set-version";

const version = (...ids: number[]) => bookmarkSetVersion(new Set(ids));

describe("bookmarkSetVersion", () => {
  it("is the same for the same set in a different order", () => {
    expect(version(3, 1, 2)).toBe(version(1, 2, 3));
  });

  it("changes when one entry is added", () => {
    expect(version(1, 2, 3)).not.toBe(version(1, 2, 3, 4));
  });

  it("changes when one entry is swapped for another", () => {
    expect(version(1, 2, 3)).not.toBe(version(1, 2, 4));
  });

  /** Two real JMdict ids that differ only above the low byte. */
  it("changes when two ids differ only in their high bytes", () => {
    expect(version(1579170)).not.toBe(version(1583266));
  });

  it("has a version for the empty set", () => {
    expect(version()).toBe(bookmarkSetVersion(new Set()));
    expect(version()).not.toBe(version(1));
  });

  /**
   * The one thing a hash must not do here is collide across the edits that
   * actually happen — one id in or out of a realistic list.
   */
  it("gives 20,000 single-entry edits of a large list 20,000 names", () => {
    const base = new Set<number>();
    for (let id = 1_000_000; id < 1_008_500; id++) base.add(id);
    const seen = new Set<string>();
    for (let id = 2_000_000; id < 2_020_000; id++) {
      base.add(id);
      seen.add(bookmarkSetVersion(base));
      base.delete(id);
    }
    expect(seen.size).toBe(20_000);
  });
});
