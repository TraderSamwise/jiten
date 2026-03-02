import type { Bubble, MatchResult, MatchType } from "./types";
import { computeMatchScore } from "./scoring";

/**
 * Given a set of collected bubbles from a swipe, determine if they form a valid match.
 * A valid match is 2 or 3 bubbles from the same entry.
 */
export function evaluateSwipe(
  collected: Bubble[],
  combo: number,
  now: number,
): { match: (MatchResult & { newCombo: number }) | null; isInvalid: boolean } {
  if (collected.length < 2) {
    return { match: null, isInvalid: false };
  }

  // Group by entryId
  const byEntry = new Map<number, Bubble[]>();
  for (const b of collected) {
    const arr = byEntry.get(b.entryId) ?? [];
    arr.push(b);
    byEntry.set(b.entryId, arr);
  }

  // Find the largest group from a single entry
  let bestGroup: Bubble[] | null = null;
  for (const group of byEntry.values()) {
    if (group.length >= 2 && (!bestGroup || group.length > bestGroup.length)) {
      bestGroup = group;
    }
  }

  if (!bestGroup) {
    return { match: null, isInvalid: true };
  }

  // Check for duplicate kinds (can't match two kanji from same entry)
  const kinds = new Set(bestGroup.map((b) => b.kind));
  if (kinds.size < bestGroup.length) {
    return { match: null, isInvalid: true };
  }

  const type: MatchType = bestGroup.length >= 3 ? "triple" : "pair";
  const earliestSpawn = Math.min(...bestGroup.map((b) => b.spawnedAt));
  const result = computeMatchScore(type, combo, earliestSpawn, now);
  result.entryId = bestGroup[0].entryId;
  result.bubbleIds = bestGroup.map((b) => b.id);

  return { match: result, isInvalid: false };
}
