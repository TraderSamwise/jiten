import { afterEach, describe, expect, test, vi } from "vitest";
import {
  isReaderSentenceExplanation,
  requestReaderSentenceExplanation,
  type ReaderSentenceExplanation,
} from "./reader-explain";

const explanation: ReaderSentenceExplanation = {
  summary: "The speaker is saying they already ate.",
  translation: "I already ate.",
  grammar: [{ label: "もう", explanation: "Marks that something has already happened." }],
  vocabulary: [{ term: "食べた", reading: "たべた", meaning: "ate", note: "" }],
  notes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reader explanation client", () => {
  test("validates explanation payloads", () => {
    expect(isReaderSentenceExplanation(explanation)).toBe(true);
    expect(isReaderSentenceExplanation({ ...explanation, grammar: [{ label: "もう" }] })).toBe(
      false,
    );
  });

  test("posts selected text with auth and returns the explanation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ explanation }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestReaderSentenceExplanation({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        input: { selectedText: "  もう食べた  ", bookTitle: "Test Book" },
      }),
    ).resolves.toEqual(explanation);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/reader/explain-sentence",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selectedText: "もう食べた", bookTitle: "Test Book" }),
      }),
    );
  });

  test("requires a signed-in API token", async () => {
    await expect(
      requestReaderSentenceExplanation({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => null,
        input: { selectedText: "もう食べた" },
      }),
    ).rejects.toThrow("Sign in to use sentence explanations.");
  });
});
