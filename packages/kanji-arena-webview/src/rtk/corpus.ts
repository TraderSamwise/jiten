import type { ArenaCard, ArenaPrimitive } from "../protocol";
import type { VerbId } from "./verbs";
import { KANJI_VERBS } from "./kanji-verbs";
import { STUB_ENTRIES } from "./stub-corpus";

// The combat corpus. `keyword` comes from the host's session (the user's own
// learned kanji); `verb` (the semantic bucket a kanji reads into), `cluster`
// (near-twin grouping for exact-keyword ordeals) and `strokes` come from the
// shipped classification table. The structures below are populated at runtime by
// loadCorpus and are mutated IN PLACE so consumers that captured these bindings
// (srs.ts, DungeonScene) see the loaded data.

export interface KanjiEntry {
  kanji: string;
  keyword: string;
  verb: VerbId;
  primitives: ArenaPrimitive[];
  story: string;
  strokes: number;
  cluster?: string;
}

export const CORPUS: KanjiEntry[] = [];
export const BY_KANJI: Map<string, KanjiEntry> = new Map();
export const CLUSTERS: Record<string, KanjiEntry[]> = {};

function install(entries: KanjiEntry[]): number {
  CORPUS.length = 0;
  CORPUS.push(...entries);
  BY_KANJI.clear();
  for (const e of entries) BY_KANJI.set(e.kanji, e);
  for (const k of Object.keys(CLUSTERS)) delete CLUSTERS[k];
  for (const e of entries) {
    if (!e.cluster) continue;
    (CLUSTERS[e.cluster] ??= []).push(e);
  }
  return entries.length;
}

// Build the corpus from a session of the user's real learned kanji. Keyword is
// the host's (possibly user-overridden) keyword; verb/cluster/strokes come from
// the classification table. Kanji with no verb mapping are skipped.
export function loadCorpus(cards: ArenaCard[]): number {
  const entries: KanjiEntry[] = [];
  for (const c of cards) {
    const info = KANJI_VERBS[c.kanji];
    if (!info) continue;
    entries.push({
      kanji: c.kanji,
      keyword: c.keyword,
      verb: info.verb,
      primitives: c.primitives ?? [],
      story: c.story ?? "",
      strokes: info.strokes,
      cluster: info.cluster,
    });
  }
  return install(entries);
}

// Standalone-dev fallback so the Vite build is playable without a host session.
export function loadStubCorpus(): number {
  return install(STUB_ENTRIES);
}
