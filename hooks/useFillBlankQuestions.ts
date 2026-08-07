import { useCallback, useRef } from "react";

import { useBatchPrefetch, type BatchPrefetchState } from "@/hooks/useBatchPrefetch";
import { getFillBlankHeadword, selectDistractorCandidates } from "@/lib/fill-blank-candidates";
import {
  DISTRACTOR_COUNT,
  requestFillBlankQuestions,
  type FillBlankOption,
  type FillBlankQuestion,
  type FillBlankRequestWord,
} from "@/lib/fill-blank";
import type { DictEntry } from "@/db/types";

const BATCH_SIZE = 4;
const LOOKAHEAD = 8;
const CANDIDATES_PER_WORD = 10;

export interface FillBlankRound {
  entry: DictEntry;
  question: FillBlankQuestion;
  /** All four choices, shuffled once when the round is built. */
  options: FillBlankOption[];
  answerIndex: number;
}

function toRequestWord(entry: DictEntry, pool: DictEntry[]): FillBlankRequestWord | null {
  const word = getFillBlankHeadword(entry);
  if (!word) return null;

  const candidates = selectDistractorCandidates(entry, pool, { limit: CANDIDATES_PER_WORD });
  if (candidates.length < DISTRACTOR_COUNT) return null;

  return {
    word,
    reading: entry.kana[0]?.text ?? null,
    glosses: entry.senses
      .flatMap((sense) => sense.glosses.filter((g) => g.lang === "eng").map((g) => g.text))
      .slice(0, 4),
    partOfSpeech: [...new Set(entry.senses.flatMap((sense) => sense.partOfSpeech))].slice(0, 4),
    jlptLevel: entry.jlptLevel ?? null,
    candidates: candidates.map((candidate) => ({
      word: getFillBlankHeadword(candidate) as string,
      reading: candidate.kana[0]?.text ?? null,
      // Capped at 2 to match the request schema, which truncates there anyway.
      glosses: candidate.senses
        .flatMap((sense) => sense.glosses.filter((g) => g.lang === "eng").map((g) => g.text))
        .slice(0, 2),
    })),
  };
}

/**
 * Shuffled here rather than in the component: a shuffle during render would
 * reorder the buttons on every state change, moving the answer out from under
 * the player's finger.
 */
export function buildRound(
  entry: DictEntry,
  headword: string,
  question: FillBlankQuestion,
  random: () => number = Math.random,
): FillBlankRound {
  const answer: FillBlankOption = {
    word: headword,
    surface: question.answerSurface,
    reading: question.answerReading,
  };
  const options = [answer, ...question.distractors];

  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return { entry, question, options, answerIndex: options.indexOf(answer) };
}

export type FillBlankQuestionsState = BatchPrefetchState<DictEntry, FillBlankRound>;

/** Questions for the Fill in the Blank game, generated a batch ahead of the player. */
export function useFillBlankQuestions({
  apiBaseUrl,
  getToken,
}: {
  apiBaseUrl?: string;
  getToken: () => Promise<string | null>;
}): FillBlankQuestionsState {
  // Distractors are drawn from the whole round's words, not just the batch being
  // generated, so there is something related to choose from.
  const poolRef = useRef<DictEntry[]>([]);

  const fetchBatch = useCallback(
    async (batch: DictEntry[]): Promise<FillBlankRound[]> => {
      const requests = batch
        .map((entry) => ({ entry, request: toRequestWord(entry, poolRef.current) }))
        .filter(
          (pair): pair is { entry: DictEntry; request: FillBlankRequestWord } =>
            pair.request !== null,
        );
      // Nothing askable in this batch. Returning empty rather than calling
      // through matters: the request helper throws on an empty word list, and
      // that is not a settled failure, so the pump would retry it to death.
      if (requests.length === 0) return [];

      const result = await requestFillBlankQuestions({
        apiBaseUrl,
        getToken,
        words: requests.map((pair) => pair.request),
      });

      const byWord = new Map(result.items.map((item) => [item.word, item.question]));
      const produced: FillBlankRound[] = [];
      for (const { entry, request } of requests) {
        const question = byWord.get(request.word);
        if (question) produced.push(buildRound(entry, request.word, question));
      }
      return produced;
    },
    [apiBaseUrl, getToken],
  );

  const prefetch = useBatchPrefetch<DictEntry, FillBlankRound>({
    batchSize: BATCH_SIZE,
    lookahead: LOOKAHEAD,
    defaultErrorMessage: "Could not generate questions.",
    fetchBatch,
  });

  const prefetchStart = prefetch.start;
  const start = useCallback(
    (entries: DictEntry[]) => {
      poolRef.current = entries;
      return prefetchStart(entries);
    },
    [prefetchStart],
  );

  return { ...prefetch, start };
}
