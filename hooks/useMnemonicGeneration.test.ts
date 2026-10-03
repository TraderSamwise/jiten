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

describe("warming the rest of the node", () => {
  it("writes at most two ahead", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.prefetch([request("二"), request("三"), request("四"), request("五")]);
    });
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("skips a frame whose story it already holds", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("二"));
      await result.current.prefetch([request("二"), request("三")]);
    });
    expect(asked).toHaveBeenCalledTimes(2);
    expect(asked.mock.calls.map((c) => c[0].input.kanji)).toEqual(["二", "三"]);
  });

  it("keeps the story it has while another is on its way", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("親"));
    });

    let release: (story: string) => void = () => {};
    asked.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    await act(async () => {
      void result.current.generate(request("親"), { fresh: true });
    });
    // The editor is keyed off attempt, so the draft must survive the wait.
    expect(result.current.state).toMatchObject({
      story: "story for 親",
      attempt: 1,
      loading: true,
    });

    await act(async () => {
      release("a second story");
    });
    expect(result.current.state).toMatchObject({ story: "a second story", attempt: 2 });
  });

  it("keeps the story it has when a regenerate is refused", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate(request("親"));
    });
    asked.mockRejectedValueOnce(new Error("Daily AI quota reached."));
    await act(async () => {
      await result.current.generate(request("親"), { fresh: true });
    });
    expect(result.current.state).toMatchObject({
      story: "story for 親",
      attempt: 1,
      message: "Daily AI quota reached.",
    });
  });

  it("does not serve a story written for another keyword", async () => {
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.generate({ kanji: "親", keyword: "parent", primitives: [] });
      await result.current.generate({ kanji: "親", keyword: "folks", primitives: [] });
    });
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("charges once when a tap and a warm-ahead want the same story", async () => {
    let release: (story: string) => void = () => {};
    asked.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      void result.current.generate(request("二"));
      void result.current.prefetch([request("二")]);
      release("one story");
    });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("stops after one refusal instead of spending the rest of the quota", async () => {
    asked.mockRejectedValue(new Error("Daily AI quota reached."));
    const { result } = renderHook(() => useMnemonicGeneration());
    await act(async () => {
      await result.current.prefetch([request("二"), request("三")]);
    });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("does not keep warming a node the learner has left", async () => {
    const { result, unmount } = renderHook(() => useMnemonicGeneration());
    const prefetch = result.current.prefetch;
    unmount();
    await act(async () => {
      await prefetch([request("二"), request("三")]);
    });
    expect(asked).not.toHaveBeenCalled();
  });
});
