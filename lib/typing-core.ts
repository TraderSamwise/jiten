import {
  compareChars,
  hasFlickPending,
  isReadingCompleteFor,
  romajiToKana,
  type CharStatus,
} from "./typing-utils";

export interface TypingInputState {
  /** Raw field text — may hold unconverted romaji while an IME syllable is in flight. */
  raw: string;
  /** Kana the answer is graded and colored against. */
  target: string;
  /** Every string that counts as correct (readings plus, for dictionary entries, kanji forms). */
  acceptedReadings: string[];
  /** Caller-owned: true when the user is typing kana directly (flick/kana keyboard). */
  isKanaInput: boolean;
}

export interface TypingInputEvaluation {
  /** `raw` run through the IME conversion. */
  converted: string;
  /** Per-character feedback for `target`, with the flick-pending override applied. */
  statuses: CharStatus[];
  /** Last character is a flick intermediate (か on the way to が) — not yet wrong. */
  flickPending: boolean;
  isCorrect: boolean;
  /** Typed at least as many kana as the target without matching — grade it wrong. */
  overrun: boolean;
}

/**
 * A flick keyboard composes が by passing through か, so the trailing character
 * reads as "wrong" for a keystroke. Show it as pending instead.
 */
export function applyFlickPendingOverride(
  statuses: CharStatus[],
  converted: string,
  flickPending: boolean,
): CharStatus[] {
  if (!flickPending || statuses.length === 0) return statuses;
  const lastIdx = [...converted].length - 1;
  if (lastIdx < 0 || lastIdx >= statuses.length || statuses[lastIdx] !== "wrong") return statuses;
  const next = [...statuses];
  next[lastIdx] = "pending";
  return next;
}

function countKana(text: string): number {
  return [...text].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x3040 && code <= 0x30ff;
  }).length;
}

/**
 * Grade one keystroke of kana typing. `overrun` is already exclusive of `isCorrect`,
 * so callers can branch on correct-then-overrun in either order.
 *
 * Correctness is judged only against `acceptedReadings`; `target` drives coloring and
 * length. A caller whose `acceptedReadings` omit `target` would color an answer fully
 * correct and then grade it overrun-wrong, so `target` belongs in that set.
 */
export function evaluateTypingInput({
  raw,
  target,
  acceptedReadings,
  isKanaInput,
}: TypingInputState): TypingInputEvaluation {
  const converted = romajiToKana(raw);
  const flickPending = isKanaInput && hasFlickPending(converted, target);
  const statuses = applyFlickPendingOverride(
    compareChars(converted, target),
    converted,
    flickPending,
  );

  const isCorrect =
    isReadingCompleteFor(converted, acceptedReadings) ||
    isReadingCompleteFor(raw, acceptedReadings);

  // Only ASCII-free kana count — a trailing unconverted "d" in "いd" isn't progress.
  const targetLen = [...target].length;
  const overrun = !isCorrect && targetLen > 0 && countKana(converted) >= targetLen && !flickPending;

  return { converted, statuses, flickPending, isCorrect, overrun };
}
