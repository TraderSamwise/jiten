import { ApiError } from "./auth";

interface OpenAIResponseContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OpenAIResponseOutput {
  type?: string;
  content?: OpenAIResponseContent[];
}

interface OpenAIResponseBody {
  output_text?: string;
  output?: OpenAIResponseOutput[];
  status?: string;
  incomplete_details?: { reason?: string };
}

interface CreateStructuredJsonOptions {
  logPrefix: string;
  userId: string;
  model: string;
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: object;
  maxOutputTokens: number;
  timeoutMs?: number;
}

function extractOutputText(response: OpenAIResponseBody): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  for (const output of response.output ?? []) {
    if (output?.type !== "message") continue;
    for (const content of output.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
      if (content?.type === "refusal" && typeof content.refusal === "string") {
        throw new ApiError(400, content.refusal);
      }
    }
  }
  return null;
}

export async function createStructuredJson({
  logPrefix,
  userId,
  model,
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens,
  timeoutMs = 20_000,
}: CreateStructuredJsonOptions): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(`[${logPrefix}] Missing OPENAI_API_KEY`);
    throw new ApiError(500, "Server misconfigured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input),
            },
          ],
        },
      ],
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      max_output_tokens: maxOutputTokens,
      user: userId,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[${logPrefix}] OpenAI error`, response.status, body.slice(0, 500));
    throw new ApiError(502, "AI request failed.");
  }

  const data = (await response.json()) as OpenAIResponseBody;
  const outputText = extractOutputText(data);
  if (!outputText) {
    // A response cut off by max_output_tokens carries no output text — report it
    // as truncation rather than the misleading "empty".
    if (data.status === "incomplete") {
      console.error(`[${logPrefix}] Incomplete response`, data.incomplete_details?.reason);
      throw new ApiError(502, "AI response was cut short.");
    }
    console.error(`[${logPrefix}] Missing output text`);
    throw new ApiError(502, "AI response was empty.");
  }

  try {
    return JSON.parse(outputText);
  } catch {
    console.error(`[${logPrefix}] Non-JSON response`);
    throw new ApiError(502, "AI response was malformed.");
  }
}
