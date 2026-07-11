import type { RunState } from "../core/run";
import type { KanjiEntry } from "./corpus";

// Pure relic combat rules, lifted out of DungeonScene so they can be unit-tested
// (no Phaser). Each mutates the run's streak/fluency substrate; the scene owns
// only the Phaser side-effects (HUD emit, ordeal timer, knockback).

export interface BackfireGrace {
  firstReadUsed: boolean; // First Word: one free misread per room
  ordealForgiven: boolean; // Twin-Ward: one free wrong twin per ordeal need
}

// Correct-read payoffs + the streak substrate the streak relics scale off.
// Returns whether a heal happened so the caller can refresh the HUD.
export function applyCorrectRead(
  run: RunState,
  entry: KanjiEntry,
  wasRusty: boolean,
  wasKnown: boolean,
): { healed: boolean } {
  run.streak += 1;
  if (run.relics.has("tally-cord") && run.streak % 5 === 0) run.ward = true;
  run.lastVerb = entry.verb;

  let healed = false;
  if (run.relics.has("lapse-ledger") && wasRusty) {
    run.redeemed += 1;
    if (run.redeemed % 3 === 0 && run.hp < run.maxHp) {
      run.hp += 1;
      healed = true;
    }
  }
  if (run.relics.has("fluent-seal") && wasKnown) {
    run.fluency += 1;
    if (run.fluency % 5 === 0) {
      run.maxHp += 1;
      run.hp += 1;
      healed = true;
    }
  }
  if (run.kindling.has(entry.kanji)) {
    run.kindling.delete(entry.kanji);
    run.maxHp += 1;
    run.hp += 1;
    healed = true;
  }
  return { healed };
}

// Backfire graces in priority order. Mutates run (ward/streak) and returns
// whether the hit was soaked plus the updated per-room / per-need grace flags.
export function absorbBackfire(
  run: RunState,
  inOrdeal: boolean,
  grace: BackfireGrace,
): { absorbed: boolean; grace: BackfireGrace } {
  if (run.relics.has("twin-ward") && inOrdeal && !grace.ordealForgiven) {
    return { absorbed: true, grace: { ...grace, ordealForgiven: true } };
  }
  if (run.relics.has("first-word") && !grace.firstReadUsed) {
    return { absorbed: true, grace: { ...grace, firstReadUsed: true } };
  }
  if (run.ward) {
    run.ward = false; // Tally Cord ward soaks it; streak survives
    return { absorbed: true, grace };
  }
  if (run.relics.has("backfire-sink") && run.streak >= 3) {
    run.streak = 0; // spend the streak instead of a heart
    return { absorbed: true, grace };
  }
  run.streak = 0;
  return { absorbed: false, grace };
}
