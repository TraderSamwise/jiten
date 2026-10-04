// @vitest-environment jsdom

/**
 * The hook behind the mnemonic and keyword faces. It used to return EMPTY
 * whenever a kanji had no story, which threw away the learner's keyword
 * override with it — so a frame they had renamed, but not written a story for,
 * would be asked under Heisig's word instead of theirs.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  note: null as { mnemonic: string; keyword: string | null } | null,
  userDb: null as { getFirstAsync: (sql: string, args: unknown[]) => Promise<unknown> } | null,
  dictDb: {} as object | null,
  strokesDb: {} as object | null,
  kanji: [{ literal: "親", heisigKeyword: "parent" }],
  primitives: [{ position: 1, glyph: "見", keyword: "see" }],
  /** Which literals the hook actually read, so an empty result is observable. */
  reads: [] as string[],
  primitiveLoads: [] as string[],
}));

vi.mock("@/db/user-provider", () => ({ useUserDb: () => h.userDb }));

vi.mock("@/db/provider", () => ({
  useDatabase: () => ({ dictDb: h.dictDb, strokesDb: h.strokesDb }),
}));

vi.mock("@/db/kanji-search", () => ({
  getKanjiBatchAsync: async () => h.kanji,
  getPrimitivesForKanjiAsync: async (_db: unknown, literal: string) => {
    h.primitiveLoads.push(literal);
    return h.primitives;
  },
}));

import { useMnemonicData } from "./useMnemonicData";

/**
 * The hook reads in an effect and sets state from a promise, so every
 * assertion here waits for the read to land rather than for a fixed number of
 * ticks — one tick was enough for some of these cases and not others.
 */
function settled<T>(read: () => T, want: unknown): Promise<void> {
  return waitFor(() => expect(read()).toEqual(want));
}

beforeEach(() => {
  h.note = null;
  h.reads = [];
  h.primitiveLoads = [];
  h.userDb = {
    getFirstAsync: async (_sql: string, args: unknown[]) => {
      h.reads.push(String(args[0]));
      return h.note;
    },
  };
  h.dictDb = {};
  h.strokesDb = {};
});

afterEach(() => vi.restoreAllMocks());

describe("reading a kanji's notes", () => {
  it("keeps the learner's keyword on a frame with no story", async () => {
    h.note = { mnemonic: "", keyword: "mum and dad" };
    const { result } = renderHook(() => useMnemonicData("親"));
    await settled(() => result.current.primaryKeywords, ["mum and dad"]);
    expect(result.current.mnemonic).toBeNull();
  });

  it("puts the learner's keyword ahead of Heisig's when there is a story", async () => {
    h.note = { mnemonic: "a [parent] up a tree", keyword: "mum and dad" };
    const { result } = renderHook(() => useMnemonicData("親"));
    await settled(() => result.current.primaryKeywords, ["mum and dad", "parent"]);
    expect(result.current.mnemonic).toBe("a [parent] up a tree");
  });

  it("keeps nothing from a kanji with no note at all", async () => {
    // Asserting the empty result alone would pass before the read even lands,
    // since empty IS the initial state — so wait for the read, then assert.
    h.note = null;
    const { result } = renderHook(() => useMnemonicData("親"));
    await settled(() => h.reads, ["親"]);
    expect(result.current.primaryKeywords).toEqual([]);
    expect(result.current.mnemonic).toBeNull();
  });

  it("keeps nothing when the note holds neither a story nor a keyword", async () => {
    h.note = { mnemonic: "", keyword: null };
    const { result } = renderHook(() => useMnemonicData("親"));
    await settled(() => h.reads, ["親"]);
    expect(result.current.primaryKeywords).toEqual([]);
  });

  it("loads the primitives only when there is a story to mark up", async () => {
    h.note = { mnemonic: "", keyword: "mum and dad" };
    const { result } = renderHook(() => useMnemonicData("親"));
    await settled(() => result.current.primaryKeywords, ["mum and dad"]);
    expect(result.current.primitives).toEqual([]);
    expect(h.primitiveLoads).toEqual([]);
  });

  it("reads the notes again when the card changes", async () => {
    h.note = { mnemonic: "", keyword: "mum and dad" };
    const { result, rerender } = renderHook(({ literal }) => useMnemonicData(literal), {
      initialProps: { literal: "親" },
    });
    await settled(() => result.current.primaryKeywords, ["mum and dad"]);
    h.note = { mnemonic: "", keyword: "sunrise" };
    rerender({ literal: "日" });
    await settled(() => result.current.primaryKeywords, ["sunrise"]);
  });

  it("asks nothing without a literal", async () => {
    const { result } = renderHook(() => useMnemonicData(null));
    await settled(() => h.reads, []);
    expect(result.current.primaryKeywords).toEqual([]);
  });
});
