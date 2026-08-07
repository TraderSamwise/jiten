/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictEntry } from "@/db/types";

const apiMocks = vi.hoisted(() => ({ requestContextSentences: vi.fn() }));

vi.mock("@/lib/context-sentences", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/context-sentences")>("@/lib/context-sentences");
  return { ...actual, requestContextSentences: apiMocks.requestContextSentences };
});

const { useContextSentences, toPlayableEntries } = await import("./useContextSentences");
const { ContextSentenceQuotaError, ContextSentenceUnusableError } =
  await import("@/lib/context-sentences");

function entry(id: number, kanji: string | null, kana: string): DictEntry {
  return {
    id,
    kanji: kanji ? [{ text: kanji, tags: [] }] : [],
    kana: [{ text: kana, tags: [] }],
    senses: [{ glosses: [{ lang: "eng", text: "gloss" }], partOfSpeech: ["n"] }],
    pitchAccents: [],
  } as unknown as DictEntry;
}

function sentenceFor(word: string, reading: string) {
  return {
    sentence: `毎日${word}。`,
    targetSurface: word,
    targetReading: reading,
    english: "Every day.",
  };
}

const entries = [entry(1, "食べる", "たべる"), entry(2, "飲む", "のむ"), entry(3, "本", "ほん")];

function renderSentences() {
  return renderHook(() =>
    useContextSentences({ apiBaseUrl: "https://api.example.com", getToken: async () => "token" }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("toPlayableEntries", () => {
  it("drops kana-only entries, which have no kanji to read", () => {
    const playable = toPlayableEntries([entry(1, "食べる", "たべる"), entry(2, null, "たくさん")]);
    expect(playable.map((e) => e.id)).toEqual([1]);
  });

  it("ignores search-only kanji forms", () => {
    const hidden = entry(3, null, "ほん");
    hidden.kanji = [{ text: "本", tags: ["sK"] }] as DictEntry["kanji"];
    expect(toPlayableEntries([hidden])).toEqual([]);
  });
});

describe("useContextSentences", () => {
  it("produces a round per word returned by the first batch", async () => {
    apiMocks.requestContextSentences.mockResolvedValue({
      items: [
        { word: "食べる", sentences: [sentenceFor("食べる", "たべる")] },
        { word: "飲む", sentences: [sentenceFor("飲む", "のむ")] },
        { word: "本", sentences: [sentenceFor("本", "ほん")] },
      ],
    });

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(entries);
    });

    await waitFor(() => expect(result.current.rounds).toHaveLength(3));
    expect(result.current.rounds[0].entry.id).toBe(1);
    expect(result.current.rounds[0].sentence.targetReading).toBe("たべる");
    expect(result.current.hasMore).toBe(false);
  });

  it("skips words the model returned nothing playable for", async () => {
    apiMocks.requestContextSentences.mockResolvedValue({
      items: [{ word: "食べる", sentences: [sentenceFor("食べる", "たべる")] }],
    });

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(entries);
    });

    await waitFor(() => expect(result.current.rounds).toHaveLength(1));
    expect(result.current.rounds[0].entry.id).toBe(1);
  });

  it("retries a failed batch once before giving up on it", async () => {
    apiMocks.requestContextSentences
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        items: [{ word: "食べる", sentences: [sentenceFor("食べる", "たべる")] }],
      });

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(entries);
    });

    expect(apiMocks.requestContextSentences).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.rounds).toHaveLength(1));
  });

  it("propagates a first-batch failure so the caller can stay on the select screen", async () => {
    apiMocks.requestContextSentences.mockRejectedValue(new Error("AI request failed."));

    const { result } = renderSentences();
    await act(async () => {
      await expect(result.current.start(entries)).rejects.toThrow("AI request failed.");
    });

    expect(result.current.hasMore).toBe(false);
    expect(result.current.rounds).toEqual([]);
  });

  it("stops without retrying when the quota is spent", async () => {
    apiMocks.requestContextSentences.mockRejectedValue(new ContextSentenceQuotaError("no quota"));

    const { result } = renderSentences();
    await act(async () => {
      await expect(result.current.start(entries)).rejects.toThrow("no quota");
    });

    // Quota errors skip the retry — one attempt only
    expect(apiMocks.requestContextSentences).toHaveBeenCalledTimes(1);
    expect(result.current.quotaExhausted).toBe(true);
  });

  it("does not retry an unusable response — quota is already spent on it", async () => {
    apiMocks.requestContextSentences.mockRejectedValue(
      new ContextSentenceUnusableError("Sentence response was malformed."),
    );

    const { result } = renderSentences();
    await act(async () => {
      await expect(result.current.start(entries)).rejects.toThrow("malformed");
    });

    expect(apiMocks.requestContextSentences).toHaveBeenCalledTimes(1);
  });

  it("keeps generating past the first batch and reports a dropped one", async () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(i + 1, "本", "ほん"));
    apiMocks.requestContextSentences
      .mockResolvedValueOnce({ items: [{ word: "本", sentences: [sentenceFor("本", "ほん")] }] })
      .mockRejectedValueOnce(new ContextSentenceUnusableError("nothing usable"))
      .mockResolvedValueOnce({ items: [{ word: "本", sentences: [sentenceFor("本", "ほん")] }] });

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(many);
    });

    // Batches of 5, 5, 2: the first and last succeeded, the middle one was dropped.
    // Every entry here shares one headword, so each batch reuses its single sentence.
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(apiMocks.requestContextSentences).toHaveBeenCalledTimes(3);
    expect(result.current.rounds).toHaveLength(7);
    expect(result.current.error).toBe("nothing usable");
  });

  it("stops after consecutive failures instead of grinding through the queue", async () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(i + 1, "本", "ほん"));
    apiMocks.requestContextSentences
      .mockResolvedValueOnce({ items: [{ word: "本", sentences: [sentenceFor("本", "ほん")] }] })
      .mockRejectedValue(new ContextSentenceUnusableError("nothing usable"));

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(many);
    });

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    // First batch, then two failures — it gives up rather than burning the queue
    expect(apiMocks.requestContextSentences).toHaveBeenCalledTimes(3);
  });

  it("clears prior rounds when a new round starts", async () => {
    apiMocks.requestContextSentences.mockResolvedValue({
      items: [{ word: "食べる", sentences: [sentenceFor("食べる", "たべる")] }],
    });

    const { result } = renderSentences();
    await act(async () => {
      await result.current.start(entries);
    });
    await waitFor(() => expect(result.current.rounds).toHaveLength(1));

    act(() => result.current.reset());
    expect(result.current.rounds).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
