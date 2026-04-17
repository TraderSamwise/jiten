import { toHiragana } from "wanakana";
import type { KanjiCharacter } from "@/db/types";

export type ReaderReadingPattern =
  | "mostly_onyomi"
  | "mostly_kunyomi"
  | "mixed_on_kun"
  | "irregular"
  | "unknown";

type ReadingKind = "on" | "kun" | "nanori";

interface ReadingSegment {
  text: string;
  kind: ReadingKind;
}

interface MatchResult {
  penalty: number;
  kinds: ReadingKind[];
}

const VOICED_EQUIVALENTS: Record<string, string[]> = {
  か: ["が"],
  き: ["ぎ"],
  く: ["ぐ"],
  け: ["げ"],
  こ: ["ご"],
  さ: ["ざ"],
  し: ["じ"],
  す: ["ず"],
  せ: ["ぜ"],
  そ: ["ぞ"],
  た: ["だ"],
  ち: ["ぢ", "じ"],
  つ: ["づ", "ず"],
  て: ["で"],
  と: ["ど"],
  は: ["ば", "ぱ"],
  ひ: ["び", "ぴ"],
  ふ: ["ぶ", "ぷ"],
  へ: ["べ", "ぺ"],
  ほ: ["ぼ", "ぽ"],
};

function normalizeKana(text: string): string {
  return toHiragana(text.replace(/\./g, "\u0000"))
    .replace(/\u0000/g, ".")
    .replace(/[-ー]/g, "");
}

function isKana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

function isKanji(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

function renderLiteralReading(literal: string): string {
  return normalizeKana(literal);
}

function withVoicedVariant(text: string): string[] {
  if (!text) return [];
  const [first, ...rest] = [...text];
  const variants = VOICED_EQUIVALENTS[first];
  if (!variants) return [];
  return variants.map((v) => `${v}${rest.join("")}`);
}

function expandKunReading(reading: string): string[] {
  const normalized = normalizeKana(reading);
  if (!normalized) return [];
  const dotIndex = normalized.indexOf(".");
  const base = dotIndex >= 0 ? normalized.slice(0, dotIndex) : normalized;
  const undotted = normalized.replace(/\./g, "");
  const variants = new Set<string>();
  if (base) variants.add(base);
  if (undotted) variants.add(undotted);
  for (const value of [...variants]) {
    for (const voiced of withVoicedVariant(value)) variants.add(voiced);
  }
  return [...variants];
}

function expandOnReading(reading: string): string[] {
  const normalized = normalizeKana(reading);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  if (/[くつちき]$/.test(normalized)) {
    variants.add(`${normalized.slice(0, -1)}っ`);
  }
  return [...variants];
}

function buildReadingSegments(kanji: KanjiCharacter): ReadingSegment[] {
  const segments: ReadingSegment[] = [];
  for (const reading of kanji.readingsOn) {
    for (const expanded of expandOnReading(reading)) {
      segments.push({ text: expanded, kind: "on" });
    }
  }
  for (const reading of kanji.readingsKun) {
    for (const expanded of expandKunReading(reading)) {
      segments.push({ text: expanded, kind: "kun" });
    }
  }
  for (const reading of kanji.nanori) {
    const normalized = normalizeKana(reading);
    if (normalized) segments.push({ text: normalized, kind: "nanori" });
  }
  return dedupeSegments(segments);
}

function dedupeSegments(segments: ReadingSegment[]): ReadingSegment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = `${segment.kind}:${segment.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyKinds(kinds: ReadingKind[]): ReaderReadingPattern {
  if (kinds.length === 0) return "unknown";
  if (kinds.includes("nanori")) return "irregular";
  const hasOn = kinds.includes("on");
  const hasKun = kinds.includes("kun");
  if (hasOn && hasKun) return "mixed_on_kun";
  if (hasOn) return "mostly_onyomi";
  if (hasKun) return "mostly_kunyomi";
  return "unknown";
}

function scoreKind(kind: ReadingKind): number {
  switch (kind) {
    case "on":
      return 0;
    case "kun":
      return 0;
    case "nanori":
      return 2;
  }
}

function matchWord(
  chars: string[],
  index: number,
  reading: string,
  pos: number,
  kanjiByLiteral: Map<string, KanjiCharacter>,
  cache: Map<string, MatchResult | null>,
): MatchResult | null {
  const key = `${index}:${pos}`;
  if (cache.has(key)) return cache.get(key)!;

  if (index === chars.length) {
    const done = pos === reading.length ? { penalty: 0, kinds: [] } : null;
    cache.set(key, done);
    return done;
  }

  const ch = chars[index];
  let best: MatchResult | null = null;

  if (!isKanji(ch)) {
    const literal = renderLiteralReading(ch);
    if (literal && reading.startsWith(literal, pos)) {
      best = matchWord(chars, index + 1, reading, pos + literal.length, kanjiByLiteral, cache);
    }
    cache.set(key, best);
    return best;
  }

  const kanji = kanjiByLiteral.get(ch);
  if (!kanji) {
    cache.set(key, null);
    return null;
  }

  for (const segment of buildReadingSegments(kanji)) {
    if (!reading.startsWith(segment.text, pos)) continue;
    const next = matchWord(
      chars,
      index + 1,
      reading,
      pos + segment.text.length,
      kanjiByLiteral,
      cache,
    );
    if (!next) continue;
    const candidate: MatchResult = {
      penalty: scoreKind(segment.kind) + next.penalty,
      kinds: [segment.kind, ...next.kinds],
    };
    if (
      !best ||
      candidate.penalty < best.penalty ||
      (candidate.penalty === best.penalty && candidate.kinds.length < best.kinds.length)
    ) {
      best = candidate;
    }
  }

  cache.set(key, best);
  return best;
}

export function classifyReaderReadingPattern(params: {
  kanjiForm: string;
  kanaForm: string;
  irregularReading?: boolean;
  kanjiByLiteral: Map<string, KanjiCharacter>;
}): ReaderReadingPattern {
  const { kanjiForm, kanaForm, irregularReading = false, kanjiByLiteral } = params;
  if (irregularReading) return "irregular";

  const chars = [...kanjiForm];
  const kanjiChars = chars.filter(isKanji);
  if (kanjiChars.length === 0) return "unknown";

  const reading = normalizeKana(kanaForm);
  if (!reading) return "unknown";

  const cache = new Map<string, MatchResult | null>();
  const result = matchWord(chars, 0, reading, 0, kanjiByLiteral, cache);
  if (!result) return "irregular";
  return classifyKinds(result.kinds);
}
