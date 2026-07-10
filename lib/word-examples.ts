import { createApiClient } from "./api-client";
import { getApiErrorMessage } from "./api-error";

export interface WordExampleSentencesRequest {
  word: string;
  reading?: string | null;
  glosses?: string[];
  partOfSpeech?: string[];
}

export interface WordExampleSentence {
  japanese: string;
  reading: string;
  english: string;
  note: string;
}

export interface WordExampleSentences {
  examples: WordExampleSentence[];
}

export async function requestWordExampleSentences({
  apiBaseUrl,
  getToken,
  input,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
  input: WordExampleSentencesRequest;
}): Promise<WordExampleSentences> {
  const word = input.word.trim();
  if (!word) {
    throw new Error("Choose a word to generate examples.");
  }
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const token = await getToken();
  if (!token) {
    throw new Error("Sign in to generate example sentences.");
  }

  const client = createApiClient(apiBaseUrl, token);
  const response = await client.api.words["example-sentences"].$post({
    json: {
      word,
      reading: input.reading ?? undefined,
      glosses: input.glosses ?? undefined,
      partOfSpeech: input.partOfSpeech ?? undefined,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, "Could not generate example sentences."));
  }
  const result = (body as { result?: unknown } | null)?.result;
  if (!isWordExampleSentences(result)) {
    throw new Error("Example sentence response was malformed.");
  }
  return result;
}

export function isWordExampleSentences(value: unknown): value is WordExampleSentences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WordExampleSentences>;
  return (
    Array.isArray(candidate.examples) &&
    candidate.examples.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as WordExampleSentence).japanese === "string" &&
        typeof (item as WordExampleSentence).reading === "string" &&
        typeof (item as WordExampleSentence).english === "string" &&
        typeof (item as WordExampleSentence).note === "string",
    )
  );
}
