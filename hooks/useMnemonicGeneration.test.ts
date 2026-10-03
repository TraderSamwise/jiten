// @vitest-environment jsdom
/**
 * The quota is charged before the model is called, so every request this hook
 * makes costs the learner a unit of 500 a day and the service one of 2,000.
 * These pin that it never spends one the learner did not ask for.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/kanji-mnemonic-ai", () => ({ requestKanjiMnemonic: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ getToken: async () => "token" }) }));
vi.mock("@/lib/env", () => ({ env: { API_BASE_URL: "https://example.test" } }));

import { requestKanjiMnemonic } from "@/lib/kanji-mnemonic-ai";
import { useMnemonicGeneration } from "./useMnemonicGeneration";

const asked = vi.mocked(requestKanjiMnemonic);

const request = (kanji: string) => ({ kanji, keyword: `kw-${kanji}`, primitives: ["a"] });

beforeEach(() => {
  asked.mockReset();
  asked.mockImplementation(async ({ input }: { input: { kanji: string } }) => {
    return `story for ${input.kanji}`;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("asking for a story", () => {
  it("asks the server once and reports it ready", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("親"));
    });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      literal: "親",
      story: "story for 親",
      attempt: 1,
      loading: false,
      message: null,
    });
  });

  it("spends nothing on a frame it has already written", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("親"));
      await result.current.generate(request("親"));
    });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("counts a fresh attempt, so a regenerate replaces the draft", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("親"));
      await result.current.generate(request("親"), { fresh: true });
    });
    expect(asked).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ attempt: 2 });
  });

  it("surfaces the server's own message rather than failing silently", async () => {
    asked.mockRejectedValueOnce(new Error("Daily AI quota reached."));
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      expect(await result.current.generate(request("親"))).toBeNull();
    });
    expect(result.current.state).toMatchObject({
      literal: "親",
      loading: false,
      message: "Daily AI quota reached.",
    });
  });
});

describe("what it will not do", () => {
  it("has no way to generate for a frame the learner has not asked about", () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    // Warming the frames ahead was removed: it generated for frames nobody had
    // reached and billed the quota for stories that were never shown.
    expect(Object.keys(result.current).sort()).toEqual(["generate", "state"]);
  });

  it("charges once when two taps race for the same story", async () => {
    let release: (story: string) => void = () => {};
    asked.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      void result.current.generate(request("二"));
      void result.current.generate(request("二"));
      release("one story");
    });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("does not serve a story written for another keyword", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate({ kanji: "親", keyword: "parent", primitives: ["a"] });
      await result.current.generate({ kanji: "親", keyword: "folks", primitives: ["a"] });
    });
    expect(asked).toHaveBeenCalledTimes(2);
  });
});
