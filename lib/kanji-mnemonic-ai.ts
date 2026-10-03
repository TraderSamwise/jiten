import { createApiClient } from "./api-client";
import { getApiErrorMessage } from "./api-error";

export interface KanjiMnemonicRequest {
  kanji: string;
  keyword: string;
  primitives: string[];
}

// Server-side response guard, shared with the Hono route (server/routes/kanjiMnemonic).
export function isKanjiMnemonicStory(value: unknown): value is { story: string } {
  return (
    !!value && typeof value === "object" && typeof (value as { story?: unknown }).story === "string"
  );
}

// Ask the server to draft an RTK-style mnemonic story from a kanji's keyword and
// primitives. Mirrors the reader sentence-explain client: typed RPC call, Bearer
// auth, and a validated string back. Throws on missing config / auth / malformed
// response.
export async function requestKanjiMnemonic({
  apiBaseUrl,
  getToken,
  input,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
  input: KanjiMnemonicRequest;
}): Promise<string> {
  if (!input.kanji || !input.keyword) {
    throw new Error("Missing kanji or keyword.");
  }
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const token = await getToken();
  if (!token) {
    throw new Error("Sign in to generate stories.");
  }

  const client = createApiClient(apiBaseUrl, token);
  const response = await client.api.kanji.mnemonic.$post({
    json: {
      kanji: input.kanji,
      keyword: input.keyword,
      primitives: input.primitives,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, "Could not generate a story."));
  }
  const story = (body as { story?: unknown } | null)?.story;
  if (typeof story !== "string") {
    throw new Error("Story response was malformed.");
  }
  return story;
}
