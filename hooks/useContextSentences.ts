import { useCallback, useRef, useState } from "react";

import {
  ContextSentenceQuotaError,
  ContextSentenceUnusableError,
  requestContextSentences,
  type ContextSentence,
  type ContextSentenceRequestWord,
} from "@/lib/context-sentences";
import { shouldHide } from "@/lib/tags";
import type { DictEntry } from "@/db/types";

const BATCH_SIZE = 5;
/** Rounds kept in front of the player so a slow batch never stalls play. */
const LOOKAHEAD = 10;
/** Nothing is cached, so a second failure in a row means stop, not retry harder. */
const MAX_CONSECUTIVE_FAILURES = 2;

export interface ContextRound {
  entry: DictEntry;
  sentence: ContextSentence;
}

/** The kanji form the player will be reading — kana-only entries have nothing to read. */
export function getContextHeadword(entry: DictEntry): string | null {
  return entry.kanji.find((form) => !shouldHide(form.tags))?.text ?? null;
}

/** Only entries written with kanji can be played. */
export function toPlayableEntries(entries: DictEntry[]): DictEntry[] {
  return entries.filter((entry) => getContextHeadword(entry) !== null);
}

function toRequestWord(entry: DictEntry): ContextSentenceRequestWord | null {
  const word = getContextHeadword(entry);
  if (!word) return null;
  return {
    word,
    reading: entry.kana[0]?.text ?? null,
    glosses: entry.senses
      .flatMap((sense) => sense.glosses.filter((g) => g.lang === "eng").map((g) => g.text))
      .slice(0, 6),
    partOfSpeech: [...new Set(entry.senses.flatMap((sense) => sense.partOfSpeech))].slice(0, 8),
    jlptLevel: entry.jlptLevel ?? null,
  };
}

export interface ContextSentencesState {
  rounds: ContextRound[];
  /** More rounds can still arrive — the player is waiting, not finished. */
  hasMore: boolean;
  quotaExhausted: boolean;
  error: string | null;
  start: (entries: DictEntry[]) => Promise<number>;
  ensureAhead: (currentIndex: number) => void;
  reset: () => void;
}

/**
 * Generates sentences for a round in batches, staying ahead of the player.
 * Session-scoped and in-memory: nothing is cached between rounds.
 */
export function useContextSentences({
  apiBaseUrl,
  getToken,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
}): ContextSentencesState {
  const [rounds, setRounds] = useState<ContextRound[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queueRef = useRef<DictEntry[]>([]);
  const roundCountRef = useRef(0);
  const targetRef = useRef(LOOKAHEAD);
  const pumpingRef = useRef(false);
  const stoppedRef = useRef(false);
  const failuresRef = useRef(0);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    setHasMore(false);
  }, []);

  /** Fetch sentences for one batch of entries. Returns how many rounds it produced. */
  const fetchBatch = useCallback(
    async (batch: DictEntry[]): Promise<number> => {
      const words = batch
        .map(toRequestWord)
        .filter((word): word is ContextSentenceRequestWord => Boolean(word));
      if (words.length === 0) return 0;

      const result = await requestContextSentences({
        apiBaseUrl,
        getToken,
        words,
        // Nothing is cached, so a second sentence per word would be paid for and thrown away.
        sentencesPerWord: 1,
      });

      const byWord = new Map(result.items.map((item) => [item.word, item.sentences]));
      const produced: ContextRound[] = [];
      for (const entry of batch) {
        const headword = getContextHeadword(entry);
        const sentence = headword ? byWord.get(headword)?.[0] : undefined;
        if (sentence) produced.push({ entry, sentence });
      }

      if (produced.length > 0) {
        roundCountRef.current += produced.length;
        setRounds((prev) => [...prev, ...produced]);
      }
      return produced.length;
    },
    [apiBaseUrl, getToken],
  );

  /**
   * One retry, because a transient failure would otherwise drop five words from
   * the round. Quota exhaustion and an answered-but-unusable response are both
   * settled outcomes — retrying either would just spend quota twice.
   */
  const fetchBatchWithRetry = useCallback(
    async (batch: DictEntry[]): Promise<number> => {
      try {
        return await fetchBatch(batch);
      } catch (err) {
        if (
          err instanceof ContextSentenceQuotaError ||
          err instanceof ContextSentenceUnusableError
        ) {
          throw err;
        }
        return await fetchBatch(batch);
      }
    },
    [fetchBatch],
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
        const batch = queueRef.current.splice(0, BATCH_SIZE);
        try {
          await fetchBatchWithRetry(batch);
          failuresRef.current = 0;
        } catch (err) {
          if (err instanceof ContextSentenceQuotaError) {
            setQuotaExhausted(true);
            setError(err.message);
            stop();
            return;
          }
          // The batch is dropped either way — surfaced so a short round is explained.
          setError(err instanceof Error ? err.message : "Could not generate sentences.");
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
  }, [fetchBatchWithRetry, stop]);

  const reset = useCallback(() => {
    stoppedRef.current = false;
    queueRef.current = [];
    roundCountRef.current = 0;
    targetRef.current = LOOKAHEAD;
    failuresRef.current = 0;
    setRounds([]);
    setHasMore(false);
    setQuotaExhausted(false);
    setError(null);
  }, []);

  /**
   * Fetch the opening batch before play starts and return how many rounds it
   * produced, so the caller can report an empty round instead of an empty screen.
   */
  const start = useCallback(
    async (entries: DictEntry[]): Promise<number> => {
      reset();
      queueRef.current = [...entries];
      setHasMore(entries.length > 0);

      let produced = 0;
      try {
        produced = await fetchBatchWithRetry(queueRef.current.splice(0, BATCH_SIZE));
      } catch (err) {
        if (err instanceof ContextSentenceQuotaError) setQuotaExhausted(true);
        stop();
        throw err;
      }
      if (queueRef.current.length === 0) setHasMore(false);
      else void pump();
      return produced;
    },
    [fetchBatchWithRetry, pump, reset, stop],
  );

  const ensureAhead = useCallback(
    (currentIndex: number) => {
      targetRef.current = Math.max(targetRef.current, currentIndex + LOOKAHEAD);
      void pump();
    },
    [pump],
  );

  return { rounds, hasMore, quotaExhausted, error, start, ensureAhead, reset };
}
