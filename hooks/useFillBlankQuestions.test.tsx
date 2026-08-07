/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictEntry } from "@/db/types";

const apiMocks = vi.hoisted(() => ({ requestFillBlankQuestions: vi.fn() }));

vi.mock("@/lib/fill-blank", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fill-blank")>("@/lib/fill-blank");
  return { ...actual, requestFillBlankQuestions: apiMocks.requestFillBlankQuestions };
});

const { useFillBlankQuestions, buildRound } = await import("./useFillBlankQuestions");

function entry(id: number, kanji: string, kana: string): DictEntry {
  return {
    id,
    common: true,
    jlptLevel: 5,
    kanji: [{ text: kanji, common: true, tags: [] }],
    kana: [{ text: kana, romaji: null, common: true, tags: [] }],
    senses: [{ partOfSpeech: ["v1"], glosses: [{ lang: "eng", text: "gloss" }] }],
    pitchAccents: [],
  } as unknown as DictEntry;
}

const entries = [
  entry(1, "食べる", "たべる"),
  entry(2, "見る", "みる"),
  entry(3, "書く", "かく"),
  entry(4, "聞く", "きく"),
  entry(5, "飲む", "のむ"),
];

function questionFor(surface: string, reading: string) {
  return {
    sentence: `毎日${surface}。`,
    answerSurface: surface,
    answerReading: reading,
    english: "Every day.",
    hint: "nuance",
    distractors: [
      { word: "見る", surface: "見ます", reading: "みます" },
      { word: "書く", surface: "書きます", reading: "かきます" },
      { word: "聞く", surface: "聞きます", reading: "ききます" },
    ],
  };
}

function renderQuestions() {
  return renderHook(() =>
    useFillBlankQuestions({ apiBaseUrl: "https://api.example.com", getToken: async () => "token" }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("buildRound", () => {
  const question = questionFor("食べます", "たべます");

  it("puts all four choices in play with the answer among them", () => {
    const round = buildRound(entries[0], "食べる", question, () => 0.5);
    expect(round.options).toHaveLength(4);
    expect(round.options[round.answerIndex].surface).toBe("食べます");
    expect(new Set(round.options.map((o) => o.word)).size).toBe(4);
  });

  it("keeps answerIndex pointing at the answer wherever the shuffle put it", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const round = buildRound(entries[0], "食べる", question);
      expect(round.options[round.answerIndex].word).toBe("食べる");
      seen.add(round.answerIndex);
    }
    // A shuffle that always landed in the same slot would give the answer away
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("useFillBlankQuestions", () => {
  it("produces a round per question returned by the first batch", async () => {
    apiMocks.requestFillBlankQuestions.mockResolvedValue({
      items: [
        { word: "食べる", question: questionFor("食べます", "たべます") },
        { word: "飲む", question: questionFor("飲みます", "のみます") },
      ],
    });

    const { result } = renderQuestions();
    await act(async () => {
      await result.current.start(entries);
    });

    await waitFor(() => expect(result.current.rounds).toHaveLength(2));
    expect(result.current.rounds[0].entry.id).toBe(1);
    expect(result.current.rounds[0].options).toHaveLength(4);
  });

  it("draws distractor candidates from the whole round, not just the batch", async () => {
    apiMocks.requestFillBlankQuestions.mockResolvedValue({ items: [] });

    const { result } = renderQuestions();
    await act(async () => {
      await result.current.start(entries);
    });

    // Batch size is 4, so the fifth word can only come from the stashed pool
    const sent = apiMocks.requestFillBlankQuestions.mock.calls[0][0].words;
    expect(sent).toHaveLength(4);
    const candidateWords = sent[0].candidates.map((c: { word: string }) => c.word);
    expect(candidateWords).toContain("飲む");
    expect(candidateWords).not.toContain("食べる");
  });

  it("skips words the model returned nothing for", async () => {
    apiMocks.requestFillBlankQuestions.mockResolvedValue({
      items: [{ word: "食べる", question: questionFor("食べます", "たべます") }],
    });

    const { result } = renderQuestions();
    await act(async () => {
      await result.current.start(entries);
    });

    await waitFor(() => expect(result.current.rounds).toHaveLength(1));
    expect(result.current.rounds[0].entry.id).toBe(1);
  });

  it("does not call the API for a batch with too few candidates to choose from", async () => {
    const { result } = renderQuestions();
    await act(async () => {
      await result.current.start([entry(1, "食べる", "たべる")]);
    });

    // One word alone has no distractors, so there is nothing to ask about —
    // calling through would throw and be retried to death.
    expect(apiMocks.requestFillBlankQuestions).not.toHaveBeenCalled();
    expect(result.current.rounds).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });
});
