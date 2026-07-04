import { useCallback, useEffect, useRef, useState } from "react";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { resolveKanjiWordCandidates, type ResolvedCandidate } from "@/db/mnemonic-resolver";
import {
  activeBracketQuery,
  filterPrimitivesByQuery,
  suppressionKey,
  wordEndingAtCursor,
  type PrimitiveChoice,
  type Span,
} from "@/lib/mnemonic-suggestor";
import type { KanjiPrimitive } from "@/db/types";

export interface AmbientSuggestion {
  span: Span;
  candidate: ResolvedCandidate;
}

export interface DropdownState {
  start: number;
  query: string;
  candidates: PrimitiveChoice[];
}

const AMBIENT_DEBOUNCE_MS = 180;

/**
 * Editor engine: given the current draft text + cursor, surfaces the `[`-triggered
 * primitive dropdown (synchronous) and a debounced ambient link suggestion for the word
 * at the cursor (via the resolver). Rejected words are suppressed for the session so the
 * suggestor never re-fights a correction. The editor decides how to present each.
 */
export function useMnemonicSuggestor(
  literal: string,
  text: string,
  cursor: number,
  primitives: KanjiPrimitive[],
) {
  const { strokesDb } = useDatabase();
  const userDb = useUserDb();
  const suppressed = useRef<Set<string>>(new Set());
  const [ambient, setAmbient] = useState<AmbientSuggestion | null>(null);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);

  // Dropdown: synchronous, so `primitives` lives here and never resets the ambient timer.
  useEffect(() => {
    const bracket = activeBracketQuery(text, cursor);
    setDropdown(
      bracket
        ? {
            start: bracket.start,
            query: bracket.query,
            candidates: filterPrimitivesByQuery(primitives, bracket.query),
          }
        : null,
    );
  }, [text, cursor, primitives]);

  // Ambient: debounced resolver lookup for the completed word; skipped inside a bracket.
  useEffect(() => {
    if (activeBracketQuery(text, cursor)) {
      setAmbient(null);
      return;
    }
    const word = wordEndingAtCursor(text, cursor);
    if (!word || suppressed.current.has(suppressionKey(word.text))) {
      setAmbient(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const map = await resolveKanjiWordCandidates(strokesDb, userDb, literal, [word.text], {
          excludeCurrentNote: true,
        });
        if (cancelled || suppressed.current.has(suppressionKey(word.text))) return;
        const top = (map.get(word.text) ?? [])[0];
        setAmbient(top ? { span: word, candidate: top } : null);
      } catch {
        if (!cancelled) setAmbient(null);
      }
    }, AMBIENT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [text, cursor, literal, strokesDb, userDb]);

  const suppress = useCallback((word: string) => {
    suppressed.current.add(suppressionKey(word));
    setAmbient(null);
  }, []);

  const clearSuppression = useCallback((word: string) => {
    suppressed.current.delete(suppressionKey(word));
  }, []);

  return { ambient, dropdown, suppress, clearSuppression };
}
