import { useEffect, useState } from "react";

import { useDatabase } from "@/db/provider";
import { getKanjiBatchAsync } from "@/db/kanji-search";

/**
 * Wiktionary's account of where a character came from (CC BY-SA 4.0, credited
 * in THIRD_PARTY_NOTICES.md). Null until the dictionary carries it — the prose
 * arrives with dict base v25 — and null for a character it has no entry for.
 */
export function useGlyphOrigin(literal: string | null | undefined): string | null {
  const { dictDb } = useDatabase();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(null);
    if (!dictDb || !literal) return;
    let current = true;
    getKanjiBatchAsync(dictDb, [literal])
      .then((rows) => {
        if (current) setOrigin(rows[0]?.glyphOrigin ?? null);
      })
      .catch((err) => console.warn("[glyph-origin] could not read it", err));
    return () => {
      current = false;
    };
  }, [dictDb, literal]);

  return origin;
}
