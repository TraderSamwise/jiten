import { afterEach, describe, test, expect, vi } from "vitest";

import { AiQuotaError, AiUnusableResponseError } from "./ai-errors";
import {
  filterPlayableQuestions,
  requestFillBlankQuestions,
  toPlayableOption,
  toPlayableQuestion,
  type FillBlankRequestWord,
} from "./fill-blank";

afterEach(() => {
  vi.unstubAllGlobals();
});

const pool = (...words: string[]) => new Map(words.map((word) => [word, word]));
const CANDIDATES = pool("食べる", "見る", "書く", "聞く");

const option = (word: string, surface: string, reading: string) => ({ word, surface, reading });

const validQuestion = {
  sentence: "毎朝ニュースを読みます。",
  answerSurface: "読みます",
  answerReading: "よみます",
  english: "I read the news every morning.",
  hint: "読む is for text; 見る is for watching.",
  distractors: [
    option("見る", "見ます", "みます"),
    option("書く", "書きます", "かきます"),
    option("聞く", "聞きます", "ききます"),
  ],
};

describe("toPlayableOption", () => {
  test("accepts a conjugated form of a word from the pool", () => {
    expect(toPlayableOption(option("見る", "見ます", "みます"), CANDIDATES)).toEqual(
      option("見る", "見ます", "みます"),
    );
  });

  test("rejects a word that was never offered — options must come from the player's list", () => {
    expect(toPlayableOption(option("走る", "走ります", "はしります"), CANDIDATES)).toBeNull();
  });

  test("rejects a surface that does not belong to its own word", () => {
    // The word is in the pool but the surface is unrelated free text
    expect(toPlayableOption(option("見る", "飲みます", "のみます"), CANDIDATES)).toBeNull();
  });

  test("rejects a reading that is not kana", () => {
    expect(toPlayableOption(option("見る", "見ます", "見ます"), CANDIDATES)).toBeNull();
    expect(toPlayableOption(option("見る", "見ます", "mimasu"), CANDIDATES)).toBeNull();
  });

  test("holds a kana-only word to a kana surface — it has no kanji to anchor on", () => {
    const kana = pool("する", "ある");
    // A kana word stays kana through every conjugation
    expect(toPlayableOption(option("する", "します", "します"), kana)).not.toBeNull();
    // Without this rule any text at all could ride in on a kana headword
    expect(toPlayableOption(option("する", "食べました", "たべました"), kana)).toBeNull();
  });

  test("resolves the word back to the string the client supplied", () => {
    // 食べる decomposes (べ = へ + combining dakuten), so this echo really is a
    // different string from the pool key it has to resolve onto.
    const decomposed = "食べる".normalize("NFD");
    expect(decomposed).not.toBe("食べる");

    const result = toPlayableOption(option(decomposed, "食べます", "たべます"), CANDIDATES);
    expect(result?.word).toBe("食べる");
  });

  test("rejects missing fields and non-objects", () => {
    expect(toPlayableOption(null, CANDIDATES)).toBeNull();
    expect(toPlayableOption("見ます", CANDIDATES)).toBeNull();
    expect(toPlayableOption({ word: "見る", surface: "見ます" }, CANDIDATES)).toBeNull();
    expect(toPlayableOption(option("見る", "", "みます"), CANDIDATES)).toBeNull();
  });
});

describe("toPlayableQuestion", () => {
  const play = (overrides: Record<string, unknown> = {}) =>
    toPlayableQuestion({ ...validQuestion, ...overrides }, "読む", CANDIDATES);

  test("accepts a well-formed question", () => {
    const result = play();
    expect(result?.answerSurface).toBe("読みます");
    expect(result?.distractors).toHaveLength(3);
  });

  test("rejects an answer that does not appear exactly once in the sentence", () => {
    expect(play({ sentence: "毎朝ニュースを見ます。" })).toBeNull();
    expect(play({ sentence: "読みますか、読みますね。" })).toBeNull();
  });

  test("rejects a sentence built around a different word", () => {
    expect(toPlayableQuestion(validQuestion, "食べる", CANDIDATES)).toBeNull();
  });

  test("rejects a non-kana answer reading", () => {
    expect(play({ answerReading: "読みます" })).toBeNull();
  });

  test("drops a distractor that duplicates the answer word, leaving too few", () => {
    expect(
      toPlayableQuestion(
        {
          ...validQuestion,
          distractors: [
            option("読む", "読みます", "よみます"),
            option("見る", "見ます", "みます"),
            option("書く", "書きます", "かきます"),
          ],
        },
        "読む",
        pool("食べる", "見る", "書く", "聞く", "読む"),
      ),
    ).toBeNull();
  });

  test("rejects duplicate distractors — two buttons showing the same word", () => {
    expect(
      play({
        distractors: [
          option("見る", "見ます", "みます"),
          option("見る", "見ます", "みます"),
          option("書く", "書きます", "かきます"),
        ],
      }),
    ).toBeNull();
  });

  test("drops a distractor that reads the same as the answer — both would be right", () => {
    // 観る is its own list word but conjugates to the same みます as 見る
    const result = toPlayableQuestion(
      {
        ...validQuestion,
        answerSurface: "見ます",
        answerReading: "みます",
        sentence: "毎晩映画を見ます。",
        distractors: [
          option("観る", "観ます", "みます"),
          option("書く", "書きます", "かきます"),
          option("聞く", "聞きます", "ききます"),
          option("食べる", "食べます", "たべます"),
        ],
      },
      "見る",
      pool("観る", "書く", "聞く", "食べる"),
    );

    expect(result?.distractors.map((d) => d.word)).toEqual(["書く", "聞く", "食べる"]);
  });

  test("rejects the question outright when dropping a homophone leaves too few", () => {
    expect(
      toPlayableQuestion(
        {
          ...validQuestion,
          answerSurface: "見ます",
          answerReading: "みます",
          sentence: "毎晩映画を見ます。",
          distractors: [
            option("観る", "観ます", "みます"),
            option("書く", "書きます", "かきます"),
            option("聞く", "聞きます", "ききます"),
          ],
        },
        "見る",
        pool("観る", "書く", "聞く"),
      ),
    ).toBeNull();
  });

  test("rejects a distractor already sitting in the sentence", () => {
    expect(
      toPlayableQuestion(
        {
          ...validQuestion,
          // 見ます is one of the choices, so having it in the sentence gives it away
          sentence: "毎朝ニュースを見ますが本も読みます。",
        },
        "読む",
        CANDIDATES,
      ),
    ).toBeNull();
  });

  test("keeps only the first three when the model returns extras", () => {
    const result = play({
      distractors: [...validQuestion.distractors, option("食べる", "食べます", "たべます")],
    });
    expect(result?.distractors.map((d) => d.word)).toEqual(["見る", "書く", "聞く"]);
  });

  test("accepts an empty hint but not a missing one", () => {
    expect(play({ hint: "" })?.hint).toBe("");
    expect(play({ hint: undefined })).toBeNull();
  });
});

describe("filterPlayableQuestions", () => {
  const requests: FillBlankRequestWord[] = [
    {
      word: "読む",
      candidates: [{ word: "見る" }, { word: "書く" }, { word: "聞く" }],
    },
  ];

  test("keeps a question for a requested word", () => {
    const result = filterPlayableQuestions(
      { items: [{ word: "読む", question: validQuestion }] },
      requests,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].word).toBe("読む");
  });

  test("drops a word that was never requested", () => {
    const result = filterPlayableQuestions(
      { items: [{ word: "走る", question: validQuestion }] },
      requests,
    );
    expect(result.items).toEqual([]);
  });

  test("keeps only the first question per word", () => {
    const result = filterPlayableQuestions(
      {
        items: [
          { word: "読む", question: validQuestion },
          { word: "読む", question: validQuestion },
        ],
      },
      requests,
    );
    expect(result.items).toHaveLength(1);
  });

  test("survives a malformed payload", () => {
    expect(filterPlayableQuestions(null, requests).items).toEqual([]);
    expect(filterPlayableQuestions({ items: "nope" }, requests).items).toEqual([]);
    expect(filterPlayableQuestions({ items: [null, 7] }, requests).items).toEqual([]);
  });
});

describe("requestFillBlankQuestions", () => {
  const words: FillBlankRequestWord[] = [
    {
      word: "読む",
      reading: "よむ",
      glosses: ["to read"],
      jlptLevel: 5,
      candidates: [{ word: "見る", reading: "みる" }, { word: "書く" }, { word: "聞く" }],
    },
  ];
  const payload = { items: [{ word: "読む", question: validQuestion }] };

  function stubFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("posts the batch with auth and returns playable questions", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });

    const result = await requestFillBlankQuestions({
      apiBaseUrl: "https://api.example.com",
      getToken: async () => "token",
      words,
    });
    expect(result.items).toHaveLength(1);

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    expect(JSON.parse(init.body)).toEqual({
      words: [
        {
          word: "読む",
          reading: "よむ",
          glosses: ["to read"],
          jlptLevel: 5,
          candidates: [{ word: "見る", reading: "みる" }, { word: "書く" }, { word: "聞く" }],
        },
      ],
    });
  });

  test("times out via AbortController, not AbortSignal.timeout — RN lacks the factory", async () => {
    const original = AbortSignal.timeout;
    (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
    try {
      const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });
      await requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words,
      });
      const init = fetchMock.mock.calls[0][1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    } finally {
      (AbortSignal as unknown as { timeout?: unknown }).timeout = original;
    }
  });

  test("refuses a word without enough candidates to fill the choices", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });
    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "読む", candidates: [{ word: "見る" }] }],
      }),
    ).rejects.toThrow("Choose a word");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a batch larger than the server accepts", async () => {
    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: Array.from({ length: 5 }, (_, i) => ({
          word: `語${i}`,
          candidates: [{ word: "見る" }, { word: "書く" }, { word: "聞く" }],
        })),
      }),
    ).rejects.toThrow("at most 4 words");
  });

  test("requires configuration and a token", async () => {
    await expect(
      requestFillBlankQuestions({ getToken: async () => "token", words }),
    ).rejects.toThrow("API base URL");

    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => null,
        words,
      }),
    ).rejects.toThrow("Sign in");
  });

  test("maps quota and unusable responses onto the shared AI errors", async () => {
    stubFetch({
      ok: false,
      json: async () => ({ error: "Daily AI limit reached", code: "quota_exceeded" }),
    });
    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words,
      }),
    ).rejects.toBeInstanceOf(AiQuotaError);

    stubFetch({
      ok: false,
      json: async () => ({ error: "No usable questions.", code: "unusable_response" }),
    });
    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words,
      }),
    ).rejects.toBeInstanceOf(AiUnusableResponseError);
  });

  test("rejects a 200 whose questions are all unplayable", async () => {
    stubFetch({
      ok: true,
      json: async () => ({
        result: {
          items: [
            {
              word: "読む",
              question: {
                ...validQuestion,
                distractors: [option("走る", "走ります", "はしります")],
              },
            },
          ],
        },
      }),
    });

    await expect(
      requestFillBlankQuestions({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words,
      }),
    ).rejects.toBeInstanceOf(AiUnusableResponseError);
  });
});
