import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { requestKanjiMnemonic, type KanjiMnemonicRequest } from "@/lib/kanji-mnemonic-ai";

/** How far ahead a node warms itself after the learner's first Generate. */
const PREFETCH_AHEAD = 2;

/**
 * The last story asked for, and whether another is on its way. Deliberately not
 * a union: dropping the story while a regenerate is in flight would unmount the
 * editor holding it and take the learner's tweaks with it.
 */
export interface GenerationState {
  literal: string | null;
  story: string | null;
  /** Stories written for this frame — a key, so a new one replaces the draft. */
  attempt: number;
  loading: boolean;
  message: string | null;
}

const NOTHING: GenerationState = {
  literal: null,
  story: null,
  attempt: 0,
  loading: false,
  message: null,
};

/** A story belongs to a (frame, keyword) pair: the keyword is what it lands on. */
function cacheKey(request: KanjiMnemonicRequest): string {
  return `${request.kanji}\u0000${request.keyword}`;
}

/**
 * Asks the server for a story, once per frame-and-keyword the learner asked
 * about. The cache is what makes Regenerate and the node-ahead prefetch one
 * path, and the request id drops a reply the learner has moved past.
 */
export function useMnemonicGeneration() {
  const { getToken } = useAuth();
  const [state, setState] = useState<GenerationState>(NOTHING);
  const requestId = useRef(0);
  const stories = useRef(new Map<string, string>());
  const attempts = useRef(new Map<string, number>());
  const inFlight = useRef(new Map<string, Promise<string>>());
  // Stop warming ahead after a refusal; a story the learner asks for still tries.
  const stopWarming = useRef(false);
  const gone = useRef(false);

  useEffect(
    () => () => {
      gone.current = true;
    },
    [],
  );

  const fetchStory = useCallback(
    async (request: KanjiMnemonicRequest): Promise<string> => {
      const key = cacheKey(request);
      // One request per key in flight, so a prefetch and a tap cannot both pay.
      const running = inFlight.current.get(key);
      if (running) return running;

      const pending = requestKanjiMnemonic({
        apiBaseUrl: env.API_BASE_URL,
        getToken,
        input: request,
      })
        .then((story) => {
          stories.current.set(key, story);
          attempts.current.set(request.kanji, (attempts.current.get(request.kanji) ?? 0) + 1);
          return story;
        })
        .finally(() => {
          inFlight.current.delete(key);
        });

      inFlight.current.set(key, pending);
      return pending;
    },
    [getToken],
  );

  const attemptOf = (literal: string) => attempts.current.get(literal) ?? 0;

  const generate = useCallback(
    async (request: KanjiMnemonicRequest, opts?: { fresh?: boolean }): Promise<string | null> => {
      const id = ++requestId.current;
      const cached = opts?.fresh ? undefined : stories.current.get(cacheKey(request));
      if (cached) {
        setState({
          literal: request.kanji,
          story: cached,
          attempt: attemptOf(request.kanji),
          loading: false,
          message: null,
        });
        return cached;
      }

      // Keeps whatever story is already shown, and says one is on its way.
      setState((current) => ({
        literal: request.kanji,
        story: current.literal === request.kanji ? current.story : null,
        attempt: current.literal === request.kanji ? current.attempt : 0,
        loading: true,
        message: null,
      }));

      try {
        const story = await fetchStory(request);
        stopWarming.current = false;
        if (requestId.current !== id) return story;
        setState({
          literal: request.kanji,
          story,
          attempt: attemptOf(request.kanji),
          loading: false,
          message: null,
        });
        return story;
      } catch (err) {
        stopWarming.current = true;
        const message = err instanceof Error ? err.message : "Could not write a story.";
        if (requestId.current === id) {
          setState((current) => ({ ...current, loading: false, message }));
        }
        return null;
      }
    },
    [fetchStory],
  );

  /**
   * Warms the next frames once the learner has asked for one story. Two at a
   * time, sequentially: the quota is charged before the model is called, so a
   * speculative story costs a unit of 500 personal and 2,000 shared per day
   * whether or not it is ever read, and a refusal stops the run.
   */
  const prefetch = useCallback(
    async (requests: readonly KanjiMnemonicRequest[]): Promise<void> => {
      for (const request of requests.slice(0, PREFETCH_AHEAD)) {
        if (stopWarming.current || gone.current) return;
        if (stories.current.has(cacheKey(request))) continue;
        try {
          await fetchStory(request);
        } catch {
          stopWarming.current = true;
          return;
        }
      }
    },
    [fetchStory],
  );

  return { state, generate, prefetch };
}
