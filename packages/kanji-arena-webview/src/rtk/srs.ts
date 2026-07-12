import type Phaser from "phaser";
import type { ArenaCard } from "../protocol";
import { CLUSTERS, CORPUS } from "./corpus";
import type { KanjiEntry } from "./corpus";

// An in-memory projection of jiten's REAL SRS, re-seeded from the host session
// (seedFromSession) at the start of every run — the host owns due-timing and
// persistence (see lib/kanji-arena/grade.ts). Nothing is written to localStorage:
// the real algorithm is the single source of truth. Within a run the states here
// advance only to shape the run's flow (a reviewed card leaves the queue, a
// taught card graduates); those transitions are ephemeral and never persisted.

export type SrsState = "new" | "learning" | "due" | "lapsed" | "known";

export interface CardProgress {
  kanji: string;
  state: SrsState;
  seen: number;
  correct: number;
  wrong: number;
  streak: number;
}

export const STATE_COLOR: Record<SrsState, number> = {
  new: 0x46c6ef,
  learning: 0xb08cf0,
  due: 0xf2c14e,
  lapsed: 0xe2493b,
  known: 0x6be089,
};

const KNOWN_STREAK = 2;

export type SrsStore = Record<string, CardProgress>;
type Rng = Phaser.Math.RandomDataGenerator;

// Kanji already reviewed this run — dropped from the review-ready queue so a card
// isn't re-tested moments after you cleared it. Persists across floors within a
// run; cleared on a fresh run.
let reviewedThisRun = new Set<string>();

export function resetRun(): void {
  reviewedThisRun = new Set();
}

// The single in-memory store, re-seeded per session. Returned by reference so
// scenes that captured it keep seeing within-run advances (and re-seeds).
const sessionStore: SrsStore = {};

export function load(): SrsStore {
  return sessionStore;
}

export function stateOf(store: SrsStore, kanji: string): SrsState {
  return store[kanji]?.state ?? "new";
}

// Rusty cards are the ones whose mnemonic you should still be leaning on.
export function isRusty(state: SrsState): boolean {
  return state === "new" || state === "lapsed" || state === "learning";
}

function ensure(store: SrsStore, kanji: string): CardProgress {
  return (store[kanji] ??= { kanji, state: "new", seen: 0, correct: 0, wrong: 0, streak: 0 });
}

// Record a read attempt and advance the card. Returns the updated progress.
export function recordResult(store: SrsStore, kanji: string, ok: boolean): CardProgress {
  const c = ensure(store, kanji);
  c.seen += 1;
  if (ok) {
    c.correct += 1;
    c.streak += 1;
    c.state = c.streak >= KNOWN_STREAK ? "known" : "due";
  } else {
    c.wrong += 1;
    c.streak = 0;
    c.state = "lapsed";
  }
  reviewedThisRun.add(kanji);
  return c;
}

// Seed card states from the host session — a one-way read of the user's real
// jiten SRS state so the dungeon's due queue reflects reality on run start. The
// store is cleared IN PLACE (so references captured by scenes stay valid) and
// fully rebuilt each session. Within-run reads still advance state locally; the
// real grade goes to jiten (host result/taught → grade.ts).
export function seedFromSession(cards: ArenaCard[]): void {
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  reviewedThisRun = new Set();
  for (const c of cards) {
    const prog = ensure(sessionStore, c.kanji);
    prog.state =
      c.state === "due"
        ? "due"
        : c.state === "learning"
          ? "learning"
          : c.state === "lapsed"
            ? "lapsed"
            : c.state === "known"
              ? "known"
              : "new";
  }
}

// Acquisition (study alcove): a new card is now "seen", so it graduates into the
// due queue — no correctness recorded, it just becomes eligible to be tested.
export function markSeen(store: SrsStore, kanji: string): CardProgress {
  const c = ensure(store, kanji);
  c.seen += 1;
  if (c.state === "new") c.state = "due";
  return c;
}

// The pool combat rooms draw from — ONLY learned cards, never `new`: combat must
// never test a kanji you haven't been taught. Review-due first (lapsed/learning/
// due), then the ones you know cold as filler. `new` kanji reach combat only
// after a learning room graduates them (markSeen: new→due).
export function combatOrder(store: SrsStore, rng: Rng): KanjiEntry[] {
  const of = (st: SrsState) => CORPUS.filter((e) => stateOf(store, e.kanji) === st);
  return [
    ...rng.shuffle([...of("lapsed"), ...of("learning"), ...of("due")]),
    ...rng.shuffle(of("known")),
  ];
}

// The live review queue a room resolves combat from: learned cards actually due
// for review (lapsed/learning/due), minus any already reviewed this run.
export function reviewReady(store: SrsStore, rng: Rng): KanjiEntry[] {
  const ready = CORPUS.filter((e) => {
    const st = stateOf(store, e.kanji);
    return (st === "lapsed" || st === "learning" || st === "due") && !reviewedThisRun.has(e.kanji);
  });
  return rng.shuffle(ready);
}

export function freshOnes(store: SrsStore, rng: Rng): KanjiEntry[] {
  const news = rng.shuffle(CORPUS.filter((e) => stateOf(store, e.kanji) === "new"));
  return dependencyOrder(news);
}

// Introduce a new kanji only after any of its primitives that are ALSO new cards
// in the deck — so you learn 兄 before 克, not after. A stable topological sort:
// a real-kanji primitive present in this new set is a dependency; invented
// primitives, primitives not in the deck, and already-learned primitives impose
// nothing (the last are, by definition, already introduced). Ties keep the
// incoming shuffle for variety. Purely a runtime read order — nothing persists.
export function dependencyOrder(entries: KanjiEntry[]): KanjiEntry[] {
  const inSet = new Set(entries.map((e) => e.kanji));
  const unmet = new Map<string, Set<string>>();
  for (const e of entries) {
    const deps = new Set<string>();
    for (const p of e.primitives) {
      if (p.glyph && p.glyph !== e.kanji && inSet.has(p.glyph)) deps.add(p.glyph);
    }
    unmet.set(e.kanji, deps);
  }
  const done = new Set<string>();
  const out: KanjiEntry[] = [];
  const remaining = [...entries];
  while (remaining.length) {
    // Emit, in the incoming order, every entry whose new-primitive deps are all
    // already out. A pass that emits nothing means a cycle — break it by forcing
    // the first remaining entry, then continue.
    let progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      let ready = true;
      for (const g of unmet.get(e.kanji)!) {
        if (!done.has(g)) {
          ready = false;
          break;
        }
      }
      if (!ready) continue;
      out.push(e);
      done.add(e.kanji);
      remaining.splice(i, 1);
      i--;
      progressed = true;
    }
    if (!progressed) {
      const e = remaining.shift()!;
      out.push(e);
      done.add(e.kanji);
    }
  }
  return out;
}

// Distinct confusable clusters for precise-keyword encounters. The first is the
// meatiest available (≥3 members) so the boss gets a proper cluster.
export function pickClusters(rng: Rng, n: number): { name: string; entries: KanjiEntry[] }[] {
  const names = Object.keys(CLUSTERS);
  const big = rng.shuffle(names.filter((k) => CLUSTERS[k].length >= 3));
  const rest = rng.shuffle(names.filter((k) => k !== big[0]));
  const ordered = [big[0], ...rest].filter(Boolean);
  return ordered.slice(0, n).map((name) => ({ name, entries: CLUSTERS[name] }));
}
