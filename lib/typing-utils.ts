import { toHiragana } from "wanakana";
import type { DictEntry } from "@/db/types";

export type CharStatus = "correct" | "wrong" | "pending" | "untyped";

export function romajiToKana(raw: string): string {
  return toHiragana(raw, { IMEMode: true });
}

export function norm(s: string): string {
  return s.normalize("NFC");
}

/** Normalize katakana to hiragana for comparison (offset 0x60 between ranges) */
export function toHira(s: string): string {
  return s.replace(/[\u30A0-\u30FF]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function getTargetReading(entry: DictEntry): string {
  return entry.kana[0]?.text ?? "";
}

export function getDisplayText(entry: DictEntry): string {
  return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
}

export function getEnglishGloss(entry: DictEntry): string {
  const sense = entry.senses[0];
  if (!sense) return "";
  const first = sense.glosses.find((g) => g.lang === "eng");
  return first?.text ?? "";
}

export function compareChars(typedKana: string, target: string): CharStatus[] {
  const typedChars = [...typedKana];
  const targetChars = [...target];
  const maxLen = Math.max(typedChars.length, targetChars.length);
  const result: CharStatus[] = [];

  // Find where trailing unconverted ASCII starts (partial romaji in IME mode)
  let trailingAsciiStart = typedChars.length;
  for (let i = typedChars.length - 1; i >= 0; i--) {
    if (typedChars[i].charCodeAt(0) < 0x3040) {
      trailingAsciiStart = i;
    } else {
      break;
    }
  }

  // Trailing unconverted ASCII is "pending" if all converted kana so far matches the
  // target prefix. This handles all romanization variants generically (e.g., "c" for
  // っち where toRomaji would give "tchi" — the single-romaji check would fail).
  let trailingIsPending = false;
  if (trailingAsciiStart < typedChars.length && trailingAsciiStart <= targetChars.length) {
    let allConvertedCorrect = true;
    for (let i = 0; i < trailingAsciiStart; i++) {
      if (i >= targetChars.length || toHira(norm(typedChars[i])) !== toHira(norm(targetChars[i]))) {
        allConvertedCorrect = false;
        break;
      }
    }
    trailingIsPending = allConvertedCorrect;
  }

  for (let i = 0; i < maxLen; i++) {
    if (i >= typedChars.length) {
      result.push("untyped");
    } else if (
      i < targetChars.length &&
      toHira(norm(typedChars[i])) === toHira(norm(targetChars[i]))
    ) {
      result.push("correct");
    } else if (i >= trailingAsciiStart && trailingIsPending) {
      result.push("pending");
    } else {
      result.push("wrong");
    }
  }

  return result;
}

/** Accepted-answer check against plain strings — the entry-free core of `isReadingComplete`. */
export function isReadingCompleteFor(typedKana: string, acceptedReadings: string[]): boolean {
  const normalizedTyped = toHira(norm(typedKana));
  return acceptedReadings.some((r) => toHira(norm(r)) === normalizedTyped);
}

export function isReadingComplete(typedKana: string, entry: DictEntry): boolean {
  return isReadingCompleteFor(typedKana, getAcceptedReadings(entry));
}

/** Every string that counts as a correct answer for an entry: its readings and its kanji forms. */
export function getAcceptedReadings(entry: DictEntry): string[] {
  return [...entry.kana.map((k) => k.text), ...entry.kanji.map((k) => k.text)];
}

export function isValidPrefix(typedKana: string, entry: DictEntry): boolean {
  if (typedKana.length === 0) return true;
  const normalizedTyped = toHira(norm(typedKana));
  const readings = entry.kana.map((k) => k.text);
  return readings.some((r) => toHira(norm(r)).startsWith(normalizedTyped));
}

export type KanjiColor = "green" | "red" | "pending" | "default";

/**
 * Map kana typing progress to a color for a specific kanji/display character.
 * Proportionally maps kana statuses to display chars using ceil-biased thresholds.
 */
export function getKanjiColor(
  displayChars: string[],
  charStatuses: CharStatus[],
  totalKana: number,
  charIndex: number,
): KanjiColor {
  // Count consecutive correct kana from start
  let correctKana = 0;
  for (const status of charStatuses) {
    if (status === "correct") correctKana++;
    else break;
  }

  // A display char at index i is "covered" when correctKana >= ceil((i+1) * totalKana / totalDisplay)
  const totalDisplay = displayChars.length;
  const kanaNeeded = Math.ceil(((charIndex + 1) * totalKana) / totalDisplay);

  if (correctKana >= kanaNeeded) return "green";
  // Check if we're in the "current" zone — some kana for this kanji are correct but not all
  const prevKanaNeeded = charIndex > 0 ? Math.ceil((charIndex * totalKana) / totalDisplay) : 0;
  if (correctKana > 0 && correctKana >= prevKanaNeeded) {
    if (correctKana < charStatuses.length && charStatuses[correctKana] === "wrong") return "red";
    // Partially covered — show as in-progress (pending/untyped kana remaining)
    return "pending";
  }
  return "default";
}

// ─── Flick keyboard support ───

/**
 * Flick keyboard transitions: maps each kana to the set of kana it could
 * become via dakuten (゛), handakuten (゜), or small kana toggle.
 *
 * On a flick keyboard, composing が from か goes through か as an intermediate
 * state. This table lets us treat that intermediate as "pending" rather than "wrong".
 */
const FLICK_PAIRS: [string, string][] = [
  // Dakuten
  ...("かがきぎくぐけげこご" + "さざしじすずせぜそぞ" + "ただちぢつづてでとど" + "うゔ")
    .match(/../g)!
    .map((p) => [p[0], p[1]] as [string, string]),
  // Ha-row dakuten + handakuten (cycle: は→ば→ぱ→は)
  ["は", "ば"],
  ["ば", "ぱ"],
  ["ぱ", "は"],
  ["ひ", "び"],
  ["び", "ぴ"],
  ["ぴ", "ひ"],
  ["ふ", "ぶ"],
  ["ぶ", "ぷ"],
  ["ぷ", "ふ"],
  ["へ", "べ"],
  ["べ", "ぺ"],
  ["ぺ", "へ"],
  ["ほ", "ぼ"],
  ["ぼ", "ぽ"],
  ["ぽ", "ほ"],
  // Small kana toggle
  ["あ", "ぁ"],
  ["ぁ", "あ"],
  ["い", "ぃ"],
  ["ぃ", "い"],
  ["う", "ぅ"],
  ["ぅ", "う"],
  ["え", "ぇ"],
  ["ぇ", "え"],
  ["お", "ぉ"],
  ["ぉ", "お"],
  ["つ", "っ"],
  ["っ", "つ"],
  ["や", "ゃ"],
  ["ゃ", "や"],
  ["ゆ", "ゅ"],
  ["ゅ", "ゆ"],
  ["よ", "ょ"],
  ["ょ", "よ"],
  ["わ", "ゎ"],
  ["ゎ", "わ"],
];

const flickMap = new Map<string, Set<string>>();
for (const [from, to] of FLICK_PAIRS) {
  let set = flickMap.get(from);
  if (!set) {
    set = new Set();
    flickMap.set(from, set);
  }
  set.add(to);
}

// Build family groups: characters reachable from the same base via modifier key.
// e.g. つ, っ, づ are all in the same family (つ→っ via small toggle, つ→づ via dakuten).
// This handles multi-tap sequences like つ→っ→づ where っ is an intermediate.
const flickFamily = new Map<string, Set<string>>();
function getOrCreateFamily(char: string): Set<string> {
  let family = flickFamily.get(char);
  if (!family) {
    family = new Set([char]);
    flickFamily.set(char, family);
  }
  return family;
}
for (const [from, to] of FLICK_PAIRS) {
  const fFamily = getOrCreateFamily(from);
  const tFamily = getOrCreateFamily(to);
  if (fFamily !== tFamily) {
    // Merge the two families
    const merged = new Set([...fFamily, ...tFamily]);
    for (const ch of merged) {
      flickFamily.set(ch, merged);
    }
  }
}

/** Check if `typed` could become `target` via a valid flick keyboard transition. */
export function isFlickTransition(typed: string, target: string): boolean {
  const t = toHira(norm(typed));
  const g = toHira(norm(target));
  if (t === g) return false;
  // Direct transition (single modifier tap)
  if (flickMap.get(t)?.has(g)) return true;
  // Same family (multi-tap: both reachable from the same base character)
  const family = flickFamily.get(t);
  return family?.has(g) ?? false;
}

/**
 * Check if the last character of typedKana is in a flick-pending state —
 * all preceding characters match and the last could become correct via flick.
 */
export function hasFlickPending(typedKana: string, target: string): boolean {
  const typed = [...typedKana];
  const tgt = [...target];
  if (typed.length === 0 || typed.length > tgt.length) return false;

  // All characters except the last must match
  for (let i = 0; i < typed.length - 1; i++) {
    if (toHira(norm(typed[i])) !== toHira(norm(tgt[i]))) return false;
  }

  const lastTyped = typed[typed.length - 1];
  const lastTarget = tgt[typed.length - 1];

  // Last char already matches — not a flick pending state
  if (toHira(norm(lastTyped)) === toHira(norm(lastTarget))) return false;

  return isFlickTransition(lastTyped, lastTarget);
}
