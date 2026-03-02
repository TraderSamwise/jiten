import { SCORING, type MatchType, type MatchResult } from "./types";

export function getComboMultiplier(combo: number): number {
  const idx = Math.min(combo, SCORING.MAX_COMBO);
  return SCORING.COMBO_MULTIPLIERS[idx];
}

export function computeMatchScore(
  type: MatchType,
  combo: number,
  spawnedAt: number,
  now: number,
): MatchResult & { newCombo: number } {
  const basePoints = type === "triple" ? SCORING.TRIPLE_POINTS : SCORING.PAIR_POINTS;
  const elapsed = now - spawnedAt;
  const speedBonus = elapsed <= SCORING.SPEED_BONUS_THRESHOLD ? SCORING.SPEED_BONUS : 0;
  const newCombo = Math.min(combo + 1, SCORING.MAX_COMBO);
  const comboMultiplier = getComboMultiplier(combo);
  const totalPoints = Math.round((basePoints + speedBonus) * comboMultiplier);

  return {
    type,
    entryId: 0, // filled by caller
    bubbleIds: [], // filled by caller
    basePoints,
    speedBonus,
    comboMultiplier,
    totalPoints,
    newCombo,
  };
}
