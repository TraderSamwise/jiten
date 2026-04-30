export interface ReaderExplainRequest {
  selectedText: string;
  bookTitle?: string | null;
  surroundingText?: string | null;
}

export interface ReaderExplanationGrammarPoint {
  label: string;
  explanation: string;
}

export interface ReaderExplanationVocabularyItem {
  term: string;
  reading?: string;
  meaning: string;
  note?: string;
}

export interface ReaderSentenceExplanation {
  summary: string;
  translation: string;
  grammar: ReaderExplanationGrammarPoint[];
  vocabulary: ReaderExplanationVocabularyItem[];
  notes: string[];
}

export type ReaderSentenceExplanationState =
  | { status: "idle" }
  | { status: "loading"; selectedText: string }
  | { status: "ready"; selectedText: string; result: ReaderSentenceExplanation }
  | { status: "error"; selectedText: string; message: string };

export async function requestReaderSentenceExplanation({
  apiBaseUrl,
  getToken,
  input,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
  input: ReaderExplainRequest;
}): Promise<ReaderSentenceExplanation> {
  const selectedText = input.selectedText.trim();
  if (!selectedText) {
    throw new Error("Select text to explain.");
  }
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const token = await getToken();
  if (!token) {
    throw new Error("Sign in to use sentence explanations.");
  }

  const response = await fetch(`${apiBaseUrl}/api/reader/explain-sentence`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      selectedText,
    }),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Could not explain selection.";
    throw new Error(message);
  }
  if (!isReaderSentenceExplanation(body?.explanation)) {
    throw new Error("Explanation response was malformed.");
  }
  return body.explanation;
}

export function isReaderSentenceExplanation(value: unknown): value is ReaderSentenceExplanation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReaderSentenceExplanation>;
  return (
    typeof candidate.summary === "string" &&
    typeof candidate.translation === "string" &&
    Array.isArray(candidate.grammar) &&
    candidate.grammar.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as ReaderExplanationGrammarPoint).label === "string" &&
        typeof (item as ReaderExplanationGrammarPoint).explanation === "string",
    ) &&
    Array.isArray(candidate.vocabulary) &&
    candidate.vocabulary.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as ReaderExplanationVocabularyItem).term === "string" &&
        typeof (item as ReaderExplanationVocabularyItem).meaning === "string",
    ) &&
    Array.isArray(candidate.notes) &&
    candidate.notes.every((note) => typeof note === "string")
  );
}
