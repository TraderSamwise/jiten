import { afterEach, describe, expect, test, vi } from "vitest";

import {
  isWordExampleSentences,
  requestWordExampleSentences,
  type WordExampleSentences,
} from "./word-examples";

const examples: WordExampleSentences = {
  examples: [
    {
      japanese: "昨日、駅で友達に会いました。",
      reading: "きのう、えきでともだちにあいました。",
      english: "I met a friend at the station yesterday.",
      note: "Uses the target word in a common past-tense sentence.",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("word example sentence client", () => {
  test("validates example sentence payloads", () => {
    expect(isWordExampleSentences(examples)).toBe(true);
    expect(
      isWordExampleSentences({
        examples: [{ japanese: "猫がいる。", english: "There is a cat.", note: "" }],
      }),
    ).toBe(false);
  });

  test("posts word context with auth and returns examples", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: examples }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestWordExampleSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        input: {
          word: "  会う  ",
          reading: "あう",
          glosses: ["to meet"],
          partOfSpeech: ["v5u"],
        },
      }),
    ).resolves.toEqual(examples);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/words/example-sentences");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        word: "会う",
        reading: "あう",
        glosses: ["to meet"],
        partOfSpeech: ["v5u"],
      }),
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("requires a signed-in API token", async () => {
    await expect(
      requestWordExampleSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => null,
        input: { word: "会う" },
      }),
    ).rejects.toThrow("Sign in to generate example sentences.");
  });

  test("formats quota limit errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Daily AI limit reached",
        code: "quota_exceeded",
        quota: { limit: 100, remaining: 0, resetAt: Date.UTC(2026, 4, 2) / 1000, cost: 1 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestWordExampleSentences({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        input: { word: "会う" },
      }),
    ).rejects.toThrow("Daily AI quota reached.");
  });
});
