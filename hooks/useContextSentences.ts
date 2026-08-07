import { useCallback } from "react";

import { useBatchPrefetch, type BatchPrefetchState } from "@/hooks/useBatchPrefetch";
import {
  requestContextSentences,
  type ContextSentence,
  type ContextSentenceRequestWord,
} from "@/lib/context-sentences";
import { shouldHide } from "@/lib/tags";
import type { DictEntry } from "@/db/types";

const BATCH_SIZE = 5;
const LOOKAHEAD = 10;

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

export type ContextSentencesState = BatchPrefetchState<DictEntry, ContextRound>;

/** Sentences for the Read in Context game, generated a batch ahead of the player. */
export function useContextSentences({
  apiBaseUrl,
  getToken,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
}): ContextSentencesState {
  const fetchBatch = useCallback(
    async (batch: DictEntry[]): Promise<ContextRound[]> => {
      const words = batch
        .map(toRequestWord)
        .filter((word): word is ContextSentenceRequestWord => Boolean(word));
      // Nothing to ask about — don't spend a request on it.
      if (words.length === 0) return [];

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
      return produced;
    },
    [apiBaseUrl, getToken],
  );

  return useBatchPrefetch<DictEntry, ContextRound>({
    batchSize: BATCH_SIZE,
    lookahead: LOOKAHEAD,
    defaultErrorMessage: "Could not generate sentences.",
    fetchBatch,
  });
}
