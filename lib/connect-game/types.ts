import type { DictEntry } from "@/db/types";
import type { SpeedPreset } from "@/stores/settings";

// ─── Game modes ───

export type GameMode = "timed" | "survival" | "zen";
export type TimedDuration = 60 | 90 | 120;
export type Phase = "select" | "playing" | "done";

// ─── Bubble types ───

export type BubbleKind = "kanji" | "reading" | "meaning";

export interface Bubble {
  id: string;
  entryId: number;
  kind: BubbleKind;
  text: string;
  /** Position center X (0-1 normalized) */
  x: number;
  /** Position center Y (0-1 normalized) */
  y: number;
  /** Drift velocity X per second (normalized) */
  vx: number;
  /** Drift velocity Y per second (normalized) */
  vy: number;
  /** Width in pixels (computed from text length) */
  width: number;
  /** Height in pixels */
  height: number;
  /** When this bubble was spawned (ms) */
  spawnedAt: number;
  /** Lifetime in ms before expiry */
  lifetime: number;
  /** Whether this bubble has been collected in current swipe */
  collected: boolean;
  /** Whether this bubble has been matched and is fading out */
  matched: boolean;
  /** Whether this bubble has expired */
  expired: boolean;
}

// ─── Match results ───

export type MatchType = "pair" | "triple";

export interface MatchResult {
  type: MatchType;
  entryId: number;
  bubbleIds: string[];
  basePoints: number;
  speedBonus: number;
  comboMultiplier: number;
  totalPoints: number;
}

// ─── Wave config ───

export interface WaveConfig {
  wave: number;
  groupCount: number;
  lifetime: number;
  driftSpeed: number;
  spawnInterval: number;
}

// ─── Game state ───

export interface GameState {
  phase: Phase;
  mode: GameMode;
  timedDuration: TimedDuration;
  score: number;
  combo: number;
  maxCombo: number;
  wave: number;
  lives: number;
  matchesMade: number;
  pairsMade: number;
  triplesMade: number;
  totalSwipes: number;
  invalidSwipes: number;
  bubbles: Bubble[];
  /** Queue of entry IDs to spawn from */
  entryQueue: number[];
  /** Entries currently active (spawned but not yet matched/expired) */
  activeEntryIds: Set<number>;
  /** Timestamp when game started */
  startedAt: number;
  /** Remaining time in ms (timed mode) */
  timeRemaining: number;
  /** Entries loaded from the list */
  entries: Map<number, DictEntry>;
  /** Play field dimensions in pixels */
  fieldWidth: number;
  fieldHeight: number;
  /** Whether the game is paused */
  paused: boolean;
  /** Speed bonus threshold in ms */
  speedBonusThreshold: number;
  /** Speed preset for wave config scaling */
  speedPreset: SpeedPreset;
  /** Which bubble kinds are enabled for this game */
  enabledKinds: Set<BubbleKind>;
}

// ─── Scoring constants ───

export const SCORING = {
  PAIR_POINTS: 100,
  TRIPLE_POINTS: 350,
  SPEED_BONUS: 50,
  SPEED_BONUS_THRESHOLD: 3000,
  MISS_PENALTY: -50,
  COMBO_MULTIPLIERS: [1, 1.5, 2, 2.5, 3],
  MAX_COMBO: 4,
} as const;

export const SURVIVAL_LIVES = 3;
