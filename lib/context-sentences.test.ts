import { afterEach, describe, test, expect, vi } from "vitest";

import {
  ContextSentenceQuotaError,
  ContextSentenceUnusableError,
  filterPlayableSentences,
  isPlayableContextSentence,
  matchesHeadword,
  requestContextSentences,
} from "./context-sentences";

afterEach(() => {
  vi.unstubAllGlobals();
});

const valid = {
  sentence: "毎朝パンを食べました。",
  targetSurface: "食べました",
  targetReading: "たべました",
  english: "I ate bread every morning.",
};

describe("isPlayableContextSentence", () => {
  test("accepts a well-formed conjugated sentence", () => {
    expect(isPlayableContextSentence(valid)).toBe(true);
  });

  test("accepts a katakana reading with a long vowel mark", () => {
    expect(
      isPlayableContextSentence({
        sentence: "駅前で珈琲を飲む。",
        targetSurface: "珈琲",
        targetReading: "コーヒー",
        english: "I drink coffee in front of the station.",
      }),
    ).toBe(true);
  });

  test("rejects a target that does not appear in the sentence", () => {
    expect(isPlayableContextSentence({ ...valid, targetSurface: "飲みました" })).toBe(false);
  });

  test("rejects a target that appears twice — the red span would be ambiguous", () => {
    expect(
      isPlayableContextSentence({
        sentence: "食べる人が食べる。",
        targetSurface: "食べる",
        targetReading: "たべる",
        english: "The person who eats, eats.",
      }),
    ).toBe(false);
  });

  test("rejects a kana-only target — there is nothing to read", () => {
    expect(
      isPlayableContextSentence({
        sentence: "たくさんたべました。",
        targetSurface: "たべました",
        targetReading: "たべました",
        english: "I ate a lot.",
      }),
    ).toBe(false);
  });

  test("rejects a reading containing kanji", () => {
    expect(isPlayableContextSentence({ ...valid, targetReading: "食べました" })).toBe(false);
  });

  test("rejects a romaji reading", () => {
    expect(isPlayableContextSentence({ ...valid, targetReading: "tabemashita" })).toBe(false);
  });

  test("rejects a reading with trailing punctuation", () => {
    expect(isPlayableContextSentence({ ...valid, targetReading: "たべました。" })).toBe(false);
  });

  test("rejects empty fields", () => {
    expect(isPlayableContextSentence({ ...valid, english: "" })).toBe(false);
    expect(isPlayableContextSentence({ ...valid, sentence: "" })).toBe(false);
  });

  test("rejects an over-long sentence", () => {
    expect(isPlayableContextSentence({ ...valid, sentence: "あ".repeat(61) + "食べました" })).toBe(
      false,
    );
  });

  test("rejects non-objects and missing fields", () => {
    expect(isPlayableContextSentence(null)).toBe(false);
    expect(isPlayableContextSentence("nope")).toBe(false);
    expect(isPlayableContextSentence({ sentence: "食べました。" })).toBe(false);
  });
});

describe("matchesHeadword", () => {
  test("accepts conjugated forms that keep the headword kanji", () => {
    expect(matchesHeadword("食べました", "食べる")).toBe(true);
    expect(matchesHeadword("新しかった", "新しい")).toBe(true);
    expect(matchesHeadword("勉強しています", "勉強する")).toBe(true);
    expect(matchesHeadword("本", "本")).toBe(true);
  });

  test("rejects a surface belonging to a different word", () => {
    expect(matchesHeadword("本", "食べる")).toBe(false);
    expect(matchesHeadword("飲みました", "食べる")).toBe(false);
  });

  test("accepts an honorific prefix the headword does not carry", () => {
    expect(matchesHeadword("お待ちください", "待つ")).toBe(true);
    expect(matchesHeadword("ご飯", "飯")).toBe(true);
  });

  test("uses shared kanji when the headword starts with kana", () => {
    expect(matchesHeadword("お茶", "お茶")).toBe(true);
    expect(matchesHeadword("水", "お茶")).toBe(false);
  });

  test("accepts anything for a kana-only headword — there is nothing to anchor on", () => {
    expect(matchesHeadword("食べる", "たべる")).toBe(true);
  });
});

describe("filterPlayableSentences", () => {
  const requested = ["食べる", "飲む"];

  test("keeps good sentences and drops bad ones within a word", () => {
    const result = filterPlayableSentences(
      {
        items: [{ word: "食べる", sentences: [valid, { ...valid, targetReading: "tabemashita" }] }],
      },
      requested,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sentences).toEqual([valid]);
  });

  test("drops a word entirely when none of its sentences survive", () => {
    const result = filterPlayableSentences(
      {
        items: [
          { word: "食べる", sentences: [{ ...valid, targetSurface: "飲む" }] },
          {
            word: "飲む",
            sentences: [
              { ...valid, sentence: "水を飲む。", targetSurface: "飲む", targetReading: "のむ" },
            ],
          },
        ],
      },
      requested,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].word).toBe("飲む");
  });

  test("drops a sentence whose target is unrelated to the requested word", () => {
    const result = filterPlayableSentences(
      {
        items: [
          {
            word: "食べる",
            sentences: [
              {
                sentence: "駅で本を読む。",
                targetSurface: "本",
                targetReading: "ほん",
                english: "I read a book.",
              },
            ],
          },
        ],
      },
      requested,
    );
    expect(result.items).toEqual([]);
  });

  test("drops items for words that were never requested", () => {
    const result = filterPlayableSentences({ items: [{ word: "食べる", sentences: [valid] }] }, [
      "飲む",
    ]);
    expect(result.items).toEqual([]);
  });

  test("keeps only the first item for a duplicated word", () => {
    const second = { ...valid, sentence: "夜に食べました。" };
    const result = filterPlayableSentences(
      {
        items: [
          { word: "食べる", sentences: [valid] },
          { word: "食べる", sentences: [second] },
        ],
      },
      requested,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sentences).toEqual([valid]);
  });

  test("recovers a later duplicate when the first item had no usable sentences", () => {
    const result = filterPlayableSentences(
      {
        items: [
          { word: "食べる", sentences: [{ ...valid, targetReading: "tabemashita" }] },
          { word: "食べる", sentences: [valid] },
        ],
      },
      requested,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sentences).toEqual([valid]);
  });

  test("tolerates a whitespace-padded echoed word", () => {
    const result = filterPlayableSentences(
      { items: [{ word: " 食べる ", sentences: [valid] }] },
      requested,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].word).toBe("食べる");
  });

  test("drops invalid sentences before applying the cap", () => {
    const result = filterPlayableSentences(
      {
        items: [{ word: "食べる", sentences: [{ ...valid, targetReading: "tabemashita" }, valid] }],
      },
      requested,
      1,
    );
    expect(result.items[0].sentences).toEqual([valid]);
  });

  test("caps sentences per word", () => {
    const second = { ...valid, sentence: "夜に食べました。" };
    const result = filterPlayableSentences(
      { items: [{ word: "食べる", sentences: [valid, second] }] },
      requested,
      1,
    );
    expect(result.items[0].sentences).toEqual([valid]);
  });

  test("survives malformed payloads and junk sentence entries", () => {
    expect(filterPlayableSentences(null, requested)).toEqual({ items: [] });
    expect(filterPlayableSentences({}, requested)).toEqual({ items: [] });
    expect(filterPlayableSentences({ items: "nope" }, requested)).toEqual({ items: [] });
    expect(
      filterPlayableSentences({ items: [{ word: "食べる", sentences: [null, 42] }] }, requested),
    ).toEqual({ items: [] });
    expect(
      filterPlayableSentences({ items: [{ word: "", sentences: [valid] }] }, requested),
    ).toEqual({ items: [] });
  });
});

describe("requestContextSentences", () => {
  const payload = { items: [{ word: "食べる", sentences: [valid] }] };

  function stubFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("posts the batch with auth and returns playable sentences", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });

    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "  食べる  ", reading: "たべる", glosses: ["to eat"], jlptLevel: 5 }],
        sentencesPerWord: 2,
      }),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/words/context-sentences");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    expect(JSON.parse(init.body)).toEqual({
      words: [{ word: "食べる", reading: "たべる", glosses: ["to eat"], jlptLevel: 5 }],
      sentencesPerWord: 2,
    });
  });

  test("omits sentencesPerWord when unset and clamps it when out of range", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });

    await requestContextSentences({
      apiBaseUrl: "https://api.example.com",
      getToken: async () => "token",
      words: [{ word: "食べる" }],
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      words: [{ word: "食べる" }],
    });

    await requestContextSentences({
      apiBaseUrl: "https://api.example.com",
      getToken: async () => "token",
      words: [{ word: "食べる", jlptLevel: 9 }],
      sentencesPerWord: 7,
    });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.sentencesPerWord).toBe(3);
    expect(second.words[0].jlptLevel).toBe(5);
  });

  test("rejects an empty batch before hitting the network", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ result: payload }) });
    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "   " }],
      }),
    ).rejects.toThrow("Choose a word");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a batch larger than the server accepts", async () => {
    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: Array.from({ length: 6 }, (_, i) => ({ word: `語${i}` })),
      }),
    ).rejects.toThrow("at most 5 words");
  });

  test("requires configuration and a token", async () => {
    await expect(
      requestContextSentences({ getToken: async () => "token", words: [{ word: "食べる" }] }),
    ).rejects.toThrow("API base URL");

    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => null,
        words: [{ word: "食べる" }],
      }),
    ).rejects.toThrow("Sign in");
  });

  test("surfaces a quota error as ContextSentenceQuotaError", async () => {
    stubFetch({
      ok: false,
      json: async () => ({
        error: "Daily AI limit reached",
        code: "quota_exceeded",
        quota: { limit: 100, remaining: 0, resetAt: 1_800_000_000, cost: 2 },
      }),
    });

    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "食べる" }],
      }),
    ).rejects.toBeInstanceOf(ContextSentenceQuotaError);
  });

  test("surfaces an unusable 502 as ContextSentenceUnusableError so it is not retried", async () => {
    stubFetch({
      ok: false,
      json: async () => ({
        error: "No usable sentences were generated.",
        code: "unusable_response",
      }),
    });

    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "食べる" }],
      }),
    ).rejects.toBeInstanceOf(ContextSentenceUnusableError);
  });

  test("propagates other server errors as plain errors", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "AI request failed." }) });

    const promise = requestContextSentences({
      apiBaseUrl: "https://api.example.com",
      getToken: async () => "token",
      words: [{ word: "食べる" }],
    });
    await expect(promise).rejects.toThrow("AI request failed.");
    await expect(promise).rejects.not.toBeInstanceOf(ContextSentenceQuotaError);
  });

  test("rejects a response whose sentences are all unplayable", async () => {
    stubFetch({
      ok: true,
      json: async () => ({
        result: {
          items: [{ word: "食べる", sentences: [{ ...valid, targetReading: "tabemashita" }] }],
        },
      }),
    });

    await expect(
      requestContextSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        words: [{ word: "食べる" }],
      }),
    ).rejects.toThrow("malformed");
  });
});
