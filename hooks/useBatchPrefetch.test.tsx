/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiQuotaError } from "@/lib/ai-errors";
import { useBatchPrefetch } from "./useBatchPrefetch";

afterEach(cleanup);

/** Each item becomes one round, so round counts are easy to reason about. */
function renderPump(fetchBatch: (batch: number[]) => Promise<string[]>, lookahead = 2) {
  return renderHook(
    ({ fetch }: { fetch: typeof fetchBatch }) =>
      useBatchPrefetch<number, string>({
        batchSize: 2,
        lookahead,
        defaultErrorMessage: "Could not generate.",
        fetchBatch: fetch,
      }),
    { initialProps: { fetch: fetchBatch } },
  );
}

const items = Array.from({ length: 10 }, (_, i) => i + 1);

describe("useBatchPrefetch", () => {
  it("stops at the lookahead and resumes when the player advances", async () => {
    const fetchBatch = vi.fn(async (batch: number[]) => batch.map(String));
    const { result } = renderPump(fetchBatch);

    await act(async () => {
      await result.current.start(items);
    });

    // Lookahead of 2 is already satisfied by the opening batch
    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(result.current.rounds).toEqual(["1", "2"]);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.ensureAhead(2);
    });

    await waitFor(() => expect(result.current.rounds).toHaveLength(4));
  });

  it("falls back to the default message when a non-Error is thrown", async () => {
    const fetchBatch = vi
      .fn<(batch: number[]) => Promise<string[]>>()
      .mockResolvedValueOnce(["1", "2"])
      .mockRejectedValue("just a string");
    const { result } = renderPump(fetchBatch, 10);

    await act(async () => {
      await result.current.start(items);
    });

    await waitFor(() => expect(result.current.error).toBe("Could not generate."));
  });

  it("calls the newest fetchBatch after a re-render, not the one start() closed over", async () => {
    const first = vi.fn(async (batch: number[]) => batch.map(String));
    const second = vi.fn(async (batch: number[]) => batch.map((n) => `new-${n}`));

    const { result, rerender } = renderPump(first);
    await act(async () => {
      await result.current.start(items);
    });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ fetch: second });
    await act(async () => {
      result.current.ensureAhead(2);
    });

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(result.current.rounds).toEqual(["1", "2", "new-3", "new-4"]);
  });

  it("stops the queue when the quota is spent", async () => {
    const fetchBatch = vi
      .fn<(batch: number[]) => Promise<string[]>>()
      .mockResolvedValueOnce(["1", "2"])
      .mockRejectedValue(new AiQuotaError("no quota"));
    const { result } = renderPump(fetchBatch, 10);

    await act(async () => {
      await result.current.start(items);
    });

    await waitFor(() => expect(result.current.quotaExhausted).toBe(true));
    // Opening batch, then one refused batch — no retry, no grinding through the queue
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(false);
  });
});
