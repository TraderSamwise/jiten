import type { Floor, Room } from "../dungeon/types";
import type { KanjiEntry } from "../rtk/corpus";
import type { RelicId } from "../rtk/relics";
import type { SrsState } from "../rtk/srs";
import type { VerbId } from "../rtk/verbs";

// Shared run state, read by both the dungeon scene and the HUD/minimap scene.
export interface RunState {
  floor: Floor | null;
  current: Room | null;
  visited: Set<string>;
  cleared: Set<string>;
  seed: string;
  hp: number;
  maxHp: number;
  depth: number;
  bound: number;
  kotodama: number; // currency earned per bind, spent in shop rooms
  reads: number; // total committed reads this run (recall attempts)
  hits: number; // correct reads this run — reads/hits give run recall accuracy
  // SRS-driven floor content: which kanji live in each room, which rooms are
  // study alcoves, and a gen-time snapshot of each room's dominant card state
  // (for minimap colour).
  content: Map<string, KanjiEntry[]>;
  study: Set<string>;
  // Rooms whose reactive role (combat vs learning vs empty) has been decided on
  // first arrival — sticky so a room never flips role as the live queue changes.
  resolved: Set<string>;
  roomState: Map<string, SrsState>;
  // Rooms slated to become precise-keyword ordeals (boss + elite): the confusable
  // cluster + timing to resolve from LEARNED members on arrival. The resolved
  // ordeal (with needs) lands in `ordeal` below once entered.
  ordealPlan: Map<string, { cluster: string; timed: boolean; phasing: boolean; elite: boolean }>;
  // Precise-keyword encounters: roomKey → ordered keyword "needs" (elites and
  // the boss); boss ordeals are timed.
  ordeal: Map<string, { needs: string[]; timed: boolean; phasing?: boolean }>;
  elite: Set<string>;
  gauntlet: Set<string>; // dense swarm rooms: survive for a full heal
  // Relics: run-scoped blessings + the streak/fluency substrate they read.
  relics: Set<RelicId>;
  streak: number;
  ward: boolean;
  redeemed: number;
  fluency: number;
  reveals: number;
  kindling: Set<string>;
  lastVerb: VerbId | null;
  secondWind: boolean; // Second Wind relic: cheat-death charge, refreshed each floor
  reprisal: boolean; // Reprisal relic: armed by taking a hit, healed on next correct read
}

export const run: RunState = {
  floor: null,
  current: null,
  visited: new Set(),
  cleared: new Set(),
  seed: "",
  hp: 3,
  maxHp: 3,
  depth: 0,
  bound: 0,
  kotodama: 0,
  reads: 0,
  hits: 0,
  content: new Map(),
  study: new Set(),
  resolved: new Set(),
  roomState: new Map(),
  ordealPlan: new Map(),
  ordeal: new Map(),
  elite: new Set(),
  gauntlet: new Set(),
  relics: new Set(),
  streak: 0,
  ward: false,
  redeemed: 0,
  fluency: 0,
  reveals: 0,
  kindling: new Set(),
  lastVerb: null,
  secondWind: false,
  reprisal: false,
};
