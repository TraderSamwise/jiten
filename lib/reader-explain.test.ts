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

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/reader/explain-sentence");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ selectedText: "もう食べた", bookTitle: "Test Book" }));
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("content-type")).toBe("application/json");
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

  test("formats quota limit errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Daily AI limit reached",
        code: "quota_exceeded",
        quota: { limit: 100, remaining: 0, resetAt: Date.UTC(2026, 4, 2) / 1000, cost: 2 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestReaderSentenceExplanation({
        apiBaseUrl: "https://api.example.com",
        getToken: async () => "token",
        input: { selectedText: "もう食べた" },
      }),
    ).rejects.toThrow("Daily AI quota reached.");
  });
});
