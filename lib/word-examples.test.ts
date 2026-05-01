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

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/words/example-sentences",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          word: "会う",
          reading: "あう",
          glosses: ["to meet"],
          partOfSpeech: ["v5u"],
        }),
      }),
    );
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
});
