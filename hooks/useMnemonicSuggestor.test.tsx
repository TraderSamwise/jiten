/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanjiPrimitive } from "@/db/types";

const resolverMocks = vi.hoisted(() => ({ resolveKanjiWordCandidates: vi.fn() }));

vi.mock("@/db/provider", () => ({ useDatabase: () => ({ strokesDb: { name: "strokes" } }) }));
vi.mock("@/db/user-provider", () => ({ useUserDb: () => ({ name: "user" }) }));
vi.mock("@/db/mnemonic-resolver", () => ({
  resolveKanjiWordCandidates: resolverMocks.resolveKanjiWordCandidates,
}));

import { useMnemonicSuggestor } from "./useMnemonicSuggestor";

const PRIMS: KanjiPrimitive[] = [
  {
    position: 0,
    glyph: null,
    primitiveId: 51,
    keyword: "house",
    isPrimitive: true,
    displayGlyph: "屆",
  },
  {
    position: 1,
    glyph: "亘",
    primitiveId: null,
    keyword: "span",
    isPrimitive: false,
    displayGlyph: null,
  },
];

const HOUSE = { target: "p51", keyword: "house", confidence: 1, source: "keyword" as const };

beforeEach(() => {
  resolverMocks.resolveKanjiWordCandidates.mockReset();
  resolverMocks.resolveKanjiWordCandidates.mockResolvedValue(new Map([["house", [HOUSE]]]));
});

describe("useMnemonicSuggestor", () => {
  it("opens the dropdown synchronously on an active bracket query", () => {
    const { result } = renderHook(() => useMnemonicSuggestor("安", "my [hou", 7, PRIMS));
    expect(result.current.dropdown).toEqual({
      start: 3,
      query: "hou",
      candidates: [{ target: "p51", keyword: "house", glyph: null, displayGlyph: "屆" }],
    });
    expect(result.current.ambient).toBeNull();
  });

  it("surfaces a debounced ambient suggestion for the completed word", async () => {
    const { result } = renderHook(() => useMnemonicSuggestor("安", "my house", 8, PRIMS));
    await waitFor(() => expect(result.current.ambient).not.toBeNull());
    expect(result.current.ambient).toEqual({
      span: { start: 3, end: 8, text: "house" },
      candidate: HOUSE,
    });
    expect(result.current.dropdown).toBeNull();
  });

  it("does not re-offer a suppressed word for the session", async () => {
    const { result, rerender } = renderHook(
      ({ text, cursor }) => useMnemonicSuggestor("安", text, cursor, PRIMS),
      { initialProps: { text: "my house", cursor: 8 } },
    );
    await waitFor(() => expect(result.current.ambient).not.toBeNull());
    act(() => result.current.suppress("house"));
    expect(result.current.ambient).toBeNull();
    // typing more then returning to the same word must not re-suggest it
    rerender({ text: "my house!", cursor: 8 });
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current.ambient).toBeNull();
  });
});
