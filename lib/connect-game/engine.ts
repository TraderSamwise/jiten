import type { DictEntry } from "@/db/types";
import type { SpeedPreset } from "@/stores/settings";
import type {
  Bubble,
  BubbleKind,
  GameState,
  GameMode,
  TimedDuration,
  WaveConfig,
  MatchResult,
} from "./types";
import { SCORING, SURVIVAL_LIVES } from "./types";
import { estimateBubbleWidth, getBubbleHeight, findSpawnPosition } from "./layout";

// ─── Wave configuration ───

const WAVE_TIERS: Record<SpeedPreset, [WaveConfig, WaveConfig, WaveConfig]> = {
  easy: [
    { wave: 0, groupCount: 2, lifetime: 20000, driftSpeed: 0, spawnInterval: 1200 },
    { wave: 0, groupCount: 2, lifetime: 18000, driftSpeed: 0, spawnInterval: 1000 },
    { wave: 0, groupCount: 3, lifetime: 15000, driftSpeed: 0.005, spawnInterval: 900 },
  ],
  normal: [
    { wave: 0, groupCount: 2, lifetime: 15000, driftSpeed: 0, spawnInterval: 900 },
    { wave: 0, groupCount: 3, lifetime: 12000, driftSpeed: 0.01, spawnInterval: 800 },
    { wave: 0, groupCount: 4, lifetime: 10000, driftSpeed: 0.015, spawnInterval: 700 },
  ],
  hard: [
    { wave: 0, groupCount: 3, lifetime: 12000, driftSpeed: 0.01, spawnInterval: 800 },
    { wave: 0, groupCount: 4, lifetime: 9000, driftSpeed: 0.02, spawnInterval: 600 },
    { wave: 0, groupCount: 5, lifetime: 7000, driftSpeed: 0.03, spawnInterval: 500 },
  ],
};

export function getWaveConfig(
  wave: number,
  speedPreset: SpeedPreset,
  mode?: GameMode,
  pairsOnly?: boolean,
): WaveConfig {
  const tiers = WAVE_TIERS[speedPreset];
  // Zen mode: always use tier 1 (flat difficulty)
  const tierIndex = mode === "zen" ? 0 : wave <= 2 ? 0 : wave <= 4 ? 1 : 2;
  const tier = tiers[tierIndex];
  // 30% more groups when only 2 kinds (fewer bubbles per group)
  const groupCount = pairsOnly ? Math.ceil(tier.groupCount * 1.3) : tier.groupCount;
  return { ...tier, groupCount, wave };
}

// ─── Bubble creation ───

let nextBubbleId = 0;

function createBubblesForEntry(
  entry: DictEntry,
  waveConfig: WaveConfig,
  existing: Bubble[],
  fieldWidth: number,
  fieldHeight: number,
  now: number,
  staggerMs: number,
  enabledKinds: Set<BubbleKind>,
): Bubble[] {
  const bubbles: Bubble[] = [];
  const items: { kind: BubbleKind; text: string }[] = [];

  // Kanji (use first kanji text if available)
  if (enabledKinds.has("kanji") && entry.kanji.length > 0) {
    items.push({ kind: "kanji", text: entry.kanji[0].text });
  }

  // Reading (first kana)
  if (enabledKinds.has("reading") && entry.kana.length > 0) {
    items.push({ kind: "reading", text: entry.kana[0].text });
  }

  // Meaning (first English gloss, truncated)
  if (enabledKinds.has("meaning")) {
    const firstGloss = entry.senses[0]?.glosses.find((g) => g.lang === "eng");
    if (firstGloss) {
      const text =
        firstGloss.text.length > 20 ? firstGloss.text.slice(0, 18) + ".." : firstGloss.text;
      items.push({ kind: "meaning", text });
    }
  }

  // Need at least 2 items to form a matchable group
  if (items.length < 2) return [];

  const allBubbles = [...existing, ...bubbles];
  for (const item of items) {
    const width = estimateBubbleWidth(item.text, item.kind);
    const height = getBubbleHeight();
    const pos = findSpawnPosition(allBubbles, width, height, fieldWidth, fieldHeight);

    // Random drift direction
    const angle = Math.random() * Math.PI * 2;
    const speed = waveConfig.driftSpeed;

    const bubble: Bubble = {
      id: `b_${nextBubbleId++}`,
      entryId: entry.id,
      kind: item.kind,
      text: item.text,
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      width,
      height,
      spawnedAt: now + staggerMs,
      lifetime: waveConfig.lifetime,
      collected: false,
      matched: false,
      expired: false,
    };

    bubbles.push(bubble);
    allBubbles.push(bubble);
  }

  return bubbles;
}

// ─── Game initialization ───

export function createInitialState(
  mode: GameMode,
  duration: TimedDuration,
  entries: DictEntry[],
  fieldWidth: number,
  fieldHeight: number,
  speedPreset: SpeedPreset = "normal",
  enabledKinds: Set<BubbleKind> = new Set(["kanji", "reading", "meaning"]),
): GameState {
  nextBubbleId = 0;

  const entryMap = new Map<number, DictEntry>();
  const entryIds: number[] = [];

  for (const e of entries) {
    // Only include entries that have at least 2 of the enabled bubble-able fields
    let fieldCount = 0;
    if (enabledKinds.has("kanji") && e.kanji.length > 0) fieldCount++;
    if (enabledKinds.has("reading") && e.kana.length > 0) fieldCount++;
    if (
      enabledKinds.has("meaning") &&
      e.senses.length > 0 &&
      e.senses[0].glosses.some((g) => g.lang === "eng")
    )
      fieldCount++;
    if (fieldCount >= 2) {
      entryMap.set(e.id, e);
      entryIds.push(e.id);
    }
  }

  // Shuffle
  for (let i = entryIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entryIds[i], entryIds[j]] = [entryIds[j], entryIds[i]];
  }

  return {
    phase: "playing",
    mode,
    timedDuration: duration,
    score: 0,
    combo: 0,
    maxCombo: 0,
    wave: 1,
    lives: mode === "survival" ? SURVIVAL_LIVES : Infinity,
    matchesMade: 0,
    pairsMade: 0,
    triplesMade: 0,
    totalSwipes: 0,
    invalidSwipes: 0,
    bubbles: [],
    entryQueue: entryIds,
    activeEntryIds: new Set(),
    startedAt: Date.now(),
    timeRemaining: mode === "timed" ? duration * 1000 : Infinity,
    entries: entryMap,
    fieldWidth,
    fieldHeight,
    paused: false,
    speedBonusThreshold: SCORING.SPEED_BONUS_THRESHOLD,
    speedPreset,
    enabledKinds,
  };
}

// ─── Spawning ───

/** Spawn a new wave of bubbles. Returns bubbles to add. */
export function spawnWave(state: GameState, now: number): Bubble[] {
  const pairsOnly = state.enabledKinds.size === 2;
  const config = getWaveConfig(state.wave, state.speedPreset, state.mode, pairsOnly);
  const newBubbles: Bubble[] = [];

  for (let i = 0; i < config.groupCount; i++) {
    if (state.entryQueue.length === 0) {
      // Recycle: re-shuffle all entry IDs
      const ids = [...state.entries.keys()];
      for (let j = ids.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [ids[j], ids[k]] = [ids[k], ids[j]];
      }
      state.entryQueue = ids;
    }

    const entryId = state.entryQueue.shift()!;
    const entry = state.entries.get(entryId);
    if (!entry) continue;

    // Skip if already active
    if (state.activeEntryIds.has(entryId)) {
      i--; // retry
      continue;
    }

    const stagger = i * config.spawnInterval;
    const bubbles = createBubblesForEntry(
      entry,
      config,
      [...state.bubbles, ...newBubbles],
      state.fieldWidth,
      state.fieldHeight,
      now,
      stagger,
      state.enabledKinds,
    );

    if (bubbles.length > 0) {
      state.activeEntryIds.add(entryId);
      newBubbles.push(...bubbles);
    }
  }

  return newBubbles;
}

// ─── Tick (per-frame update) ───

export interface TickResult {
  expired: Bubble[];
  needsNewWave: boolean;
  gameOver: boolean;
}

export function tick(state: GameState, now: number, deltaMs: number): TickResult {
  if (state.paused) return { expired: [], needsNewWave: false, gameOver: false };

  const deltaSec = deltaMs / 1000;
  const expired: Bubble[] = [];

  // Update timed mode countdown
  if (state.mode === "timed") {
    state.timeRemaining = Math.max(0, state.timedDuration * 1000 - (now - state.startedAt));
    if (state.timeRemaining <= 0) {
      return { expired: [], needsNewWave: false, gameOver: true };
    }
  }

  // Update bubble positions and check expiry
  for (const bubble of state.bubbles) {
    if (bubble.matched || bubble.expired) continue;

    // Don't update bubbles that haven't spawned yet
    if (now < bubble.spawnedAt) continue;

    // Drift
    if (bubble.vx !== 0 || bubble.vy !== 0) {
      bubble.x += bubble.vx * deltaSec;
      bubble.y += bubble.vy * deltaSec;

      // Bounce off edges
      const halfW = (bubble.width / state.fieldWidth) * 0.5;
      const halfH = (bubble.height / state.fieldHeight) * 0.5;
      if (bubble.x - halfW < 0.02) {
        bubble.x = 0.02 + halfW;
        bubble.vx = Math.abs(bubble.vx);
      } else if (bubble.x + halfW > 0.98) {
        bubble.x = 0.98 - halfW;
        bubble.vx = -Math.abs(bubble.vx);
      }
      if (bubble.y - halfH < 0.02) {
        bubble.y = 0.02 + halfH;
        bubble.vy = Math.abs(bubble.vy);
      } else if (bubble.y + halfH > 0.98) {
        bubble.y = 0.98 - halfH;
        bubble.vy = -Math.abs(bubble.vy);
      }
    }

    // Check lifetime
    const age = now - bubble.spawnedAt;
    if (age >= bubble.lifetime) {
      bubble.expired = true;
      expired.push(bubble);
    }
  }

  // Handle expired bubbles — check if full group expired (miss)
  if (expired.length > 0) {
    const expiredEntryIds = new Set(expired.map((b) => b.entryId));
    for (const entryId of expiredEntryIds) {
      const remaining = state.bubbles.filter(
        (b) => b.entryId === entryId && !b.matched && !b.expired,
      );
      if (remaining.length === 0) {
        // Full group expired = miss
        state.activeEntryIds.delete(entryId);
        if (state.mode === "zen") {
          // Zen mode: no miss penalty, no combo reset on expiry
        } else {
          if (state.mode === "survival") {
            state.lives--;
            if (state.lives <= 0) {
              return { expired, needsNewWave: false, gameOver: true };
            }
          }
          state.combo = 0;
          state.score = Math.max(0, state.score + SCORING.MISS_PENALTY);
        }
      }
    }
  }

  // Check if we need a new wave
  const livingBubbles = state.bubbles.filter((b) => !b.matched && !b.expired);
  const needsNewWave = livingBubbles.length === 0;

  return { expired, needsNewWave, gameOver: false };
}

// ─── Match handling ───

export function applyMatch(state: GameState, match: MatchResult & { newCombo: number }): void {
  state.score += match.totalPoints;
  state.combo = match.newCombo;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.matchesMade++;
  if (match.type === "triple") {
    state.triplesMade++;
  } else {
    state.pairsMade++;
  }

  // Mark matched bubbles
  for (const bubble of state.bubbles) {
    if (match.bubbleIds.includes(bubble.id)) {
      bubble.matched = true;
      bubble.collected = false;
    }
  }

  // Expire remaining bubbles from the same entry
  for (const bubble of state.bubbles) {
    if (bubble.entryId === match.entryId && !bubble.matched) {
      bubble.expired = true;
    }
  }

  state.activeEntryIds.delete(match.entryId);
}

export function handleInvalidSwipe(state: GameState): void {
  state.invalidSwipes++;
  state.combo = 0;
}

// ─── Cleanup ───

/** Remove bubbles that have been matched/expired for a while (cleanup) */
export function cleanupBubbles(state: GameState, now: number): void {
  state.bubbles = state.bubbles.filter((b) => {
    if (b.matched) return now - b.spawnedAt < b.lifetime + 1000; // keep for fade-out animation
    if (b.expired) return now - b.spawnedAt < b.lifetime + 500;
    return true;
  });
}
