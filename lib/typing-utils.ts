import { toHiragana, toRomaji } from "wanakana";
import type { DictEntry } from "@/db/types";

export type CharStatus = "correct" | "wrong" | "pending" | "untyped";

export function romajiToKana(raw: string): string {
  return toHiragana(raw, { IMEMode: true });
}

export function norm(s: string): string {
  return s.normalize("NFC");
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

  // Check if trailing ASCII is a valid romaji prefix for the remaining target kana
  let trailingIsPending = false;
  if (trailingAsciiStart < typedChars.length && trailingAsciiStart < targetChars.length) {
    const trailingAscii = typedChars.slice(trailingAsciiStart).join("");
    const remainingTarget = targetChars.slice(trailingAsciiStart).join("");
    const remainingRomaji = toRomaji(remainingTarget).toLowerCase();
    trailingIsPending = remainingRomaji.startsWith(trailingAscii.toLowerCase());
  }

  for (let i = 0; i < maxLen; i++) {
    if (i >= typedChars.length) {
      result.push("untyped");
    } else if (i < targetChars.length && norm(typedChars[i]) === norm(targetChars[i])) {
      result.push("correct");
    } else if (i >= trailingAsciiStart && trailingIsPending) {
      result.push("pending");
    } else {
      result.push("wrong");
    }
  }

  return result;
}

export function isReadingComplete(typedKana: string, entry: DictEntry): boolean {
  const normalizedTyped = norm(typedKana);
  const readings = entry.kana.map((k) => k.text);
  const kanjiTexts = entry.kanji.map((k) => k.text);
  return (
    readings.some((r) => norm(r) === normalizedTyped) ||
    kanjiTexts.some((k) => norm(k) === normalizedTyped)
  );
}

export function isValidPrefix(typedKana: string, entry: DictEntry): boolean {
  if (typedKana.length === 0) return true;
  const normalizedTyped = norm(typedKana);
  const readings = entry.kana.map((k) => k.text);
  return readings.some((r) => norm(r).startsWith(normalizedTyped));
}
