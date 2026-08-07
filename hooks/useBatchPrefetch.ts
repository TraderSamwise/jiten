import { useCallback, useRef, useState } from "react";

import { isSettledAiFailure, AiQuotaError } from "@/lib/ai-errors";

/** Nothing is cached, so a second failure in a row means stop, not retry harder. */
const MAX_CONSECUTIVE_FAILURES = 2;

export interface BatchPrefetchState<TItem, TRound> {
  rounds: TRound[];
  /** More rounds can still arrive — the player is waiting, not finished. */
  hasMore: boolean;
  quotaExhausted: boolean;
  error: string | null;
  start: (items: TItem[]) => Promise<number>;
  ensureAhead: (currentIndex: number) => void;
  reset: () => void;
}

export interface BatchPrefetchOptions<TItem, TRound> {
  batchSize: number;
  /** Rounds kept in front of the player so a slow batch never stalls play. */
  lookahead: number;
  defaultErrorMessage: string;
  /** Turns one batch of items into playable rounds. Returning [] drops the batch. */
  fetchBatch: (batch: TItem[]) => Promise<TRound[]>;
}

/**
 * Generates rounds in batches, staying ahead of the player. Session-scoped and
 * in-memory: nothing is cached between rounds, which is what makes a settled
 * failure (quota spent, nothing usable) worth stopping on rather than retrying.
 */
export function useBatchPrefetch<TItem, TRound>({
  batchSize,
  lookahead,
  defaultErrorMessage,
  fetchBatch,
}: BatchPrefetchOptions<TItem, TRound>): BatchPrefetchState<TItem, TRound> {
  const [rounds, setRounds] = useState<TRound[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queueRef = useRef<TItem[]>([]);
  const roundCountRef = useRef(0);
  const targetRef = useRef(lookahead);
  const pumpingRef = useRef(false);
  const stoppedRef = useRef(false);
  const failuresRef = useRef(0);

  // Assigned during render, not in an effect: callers build fetchBatch inline, so
  // a dependency would rebuild the pump every render, and a start() fired before
  // effects flush would otherwise run against a stale closure.
  const fetchRef = useRef(fetchBatch);
  fetchRef.current = fetchBatch;

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    setHasMore(false);
  }, []);

  const runBatch = useCallback(async (batch: TItem[]): Promise<number> => {
    const produced = await fetchRef.current(batch);
    if (produced.length > 0) {
      roundCountRef.current += produced.length;
      setRounds((prev) => [...prev, ...produced]);
    }
    return produced.length;
  }, []);

  /**
   * One retry, because a transient failure would otherwise drop a whole batch of
   * words from the round. A settled failure is not retried — the quota is already
   * spent on it.
   */
  const runBatchWithRetry = useCallback(
    async (batch: TItem[]): Promise<number> => {
      try {
        return await runBatch(batch);
      } catch (err) {
        if (isSettledAiFailure(err)) throw err;
        return await runBatch(batch);
      }
    },
    [runBatch],
  );

  const pump = useCallback(async () => {
    if (pumpingRef.current || stoppedRef.current) return;
    pumpingRef.current = true;

    try {
      // Sequential on purpose: parallel batches would race the daily quota counter.
      while (
        !stoppedRef.current &&
        queueRef.current.length > 0 &&
        roundCountRef.current < targetRef.current
      ) {
        const batch = queueRef.current.splice(0, batchSize);
        try {
          await runBatchWithRetry(batch);
          failuresRef.current = 0;
        } catch (err) {
          if (err instanceof AiQuotaError) {
            setQuotaExhausted(true);
            setError(err.message);
            stop();
            return;
          }
          // The batch is dropped either way — surfaced so a short round is explained.
          setError(err instanceof Error ? err.message : defaultErrorMessage);
          failuresRef.current += 1;
          if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
            stop();
            return;
          }
        }
      }
      if (queueRef.current.length === 0) setHasMore(false);
    } finally {
      pumpingRef.current = false;
    }
  }, [batchSize, defaultErrorMessage, runBatchWithRetry, stop]);

  const reset = useCallback(() => {
    stoppedRef.current = false;
    queueRef.current = [];
    roundCountRef.current = 0;
    targetRef.current = lookahead;
    failuresRef.current = 0;
    setRounds([]);
    setHasMore(false);
    setQuotaExhausted(false);
    setError(null);
  }, [lookahead]);

  /**
   * Fetch the opening batch before play starts and return how many rounds it
   * produced, so the caller can report an empty round instead of an empty screen.
   * A first-batch failure is rethrown rather than stored: the caller shows it on
   * the select screen, and setting `error` too would surface it twice.
   */
  const start = useCallback(
    async (items: TItem[]): Promise<number> => {
      reset();
      queueRef.current = [...items];
      setHasMore(items.length > 0);

      let produced = 0;
      try {
        produced = await runBatchWithRetry(queueRef.current.splice(0, batchSize));
      } catch (err) {
        if (err instanceof AiQuotaError) setQuotaExhausted(true);
        stop();
        throw err;
      }
      if (queueRef.current.length === 0) setHasMore(false);
      else void pump();
      return produced;
    },
    [batchSize, pump, reset, runBatchWithRetry, stop],
  );

  const ensureAhead = useCallback(
    (currentIndex: number) => {
      targetRef.current = Math.max(targetRef.current, currentIndex + lookahead);
      void pump();
    },
    [lookahead, pump],
  );

  return { rounds, hasMore, quotaExhausted, error, start, ensureAhead, reset };
}
