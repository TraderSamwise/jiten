/**
 * KANJIDIC2 parser.
 *
 * Parses the jmdict-simplified KANJIDIC2 JSON format into a Map of kanji metadata.
 * Source: https://github.com/scriptin/jmdict-simplified
 */

import * as fs from "fs";

export interface KanjidicEntry {
  literal: string;
  grade: number | null;
  strokeCount: number;
  frequencyRank: number | null;
  jlptOld: number | null;
  jlptLevel: number | null;
  readingsOn: string[];
  readingsKun: string[];
  meanings: string[];
  nanori: string[];
  radicalClassical: number | null;
  radicalNelson: number | null;
  heisigIndex: number | null;
  unicodeCodepoint: string;
}

// jmdict-simplified KANJIDIC2 format
interface KanjidicRaw {
  characters: RawCharacter[];
}

interface RawCharacter {
  literal: string;
  codepoints: { type: string; value: string }[];
  radicals: { type: string; value: number }[];
  misc: {
    grade?: number;
    strokeCounts: number[];
    frequency?: number;
    jlptLevel?: number;
    variants?: { type: string; value: string }[];
  };
  readingMeaning?: {
    groups: {
      readings: { type: string; value: string }[];
      meanings: { lang: string; value: string }[];
    }[];
    nanori: string[];
  };
  dictionaryReferences: {
    type: string;
    morohashi?: { volume: number; page: number };
    value: string;
  }[];
}

// JLPT old (1-4) to new (N1-N5) approximate mapping
// Old level 1 → N1, old level 2 → N2/N3, old level 3 → N3/N4, old level 4 → N4/N5
// This is approximate; a proper mapping needs the community JLPT N level lists
function mapJlptOldToNew(old: number | null): number | null {
  if (old === null) return null;
  switch (old) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 4;
    case 4:
      return 5;
    default:
      return null;
  }
}

export function parseKanjidic(jsonPath: string): Map<string, KanjidicEntry> {
  console.log(`  Parsing KANJIDIC2 from ${jsonPath}...`);
  const raw: KanjidicRaw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const result = new Map<string, KanjidicEntry>();

  for (const ch of raw.characters) {
    const readingsOn: string[] = [];
    const readingsKun: string[] = [];
    const meanings: string[] = [];
    let nanori: string[] = [];

    if (ch.readingMeaning) {
      for (const group of ch.readingMeaning.groups) {
        for (const r of group.readings) {
          if (r.type === "ja_on") readingsOn.push(r.value);
          else if (r.type === "ja_kun") readingsKun.push(r.value);
        }
        for (const m of group.meanings) {
          if (m.lang === "en") meanings.push(m.value);
        }
      }
      nanori = ch.readingMeaning.nanori || [];
    }

    // Extract radical numbers
    let radicalClassical: number | null = null;
    let radicalNelson: number | null = null;
    for (const rad of ch.radicals) {
      if (rad.type === "classical") radicalClassical = rad.value;
      else if (rad.type === "nelson_c") radicalNelson = rad.value;
    }

    // Extract Heisig 6th ed frame number from dictionary references
    let heisigIndex: number | null = null;
    for (const ref of ch.dictionaryReferences) {
      if (ref.type === "heisig6") {
        heisigIndex = parseInt(ref.value, 10);
        break;
      }
    }

    // Get unicode codepoint
    let unicodeCodepoint = "";
    for (const cp of ch.codepoints) {
      if (cp.type === "ucs") {
        unicodeCodepoint = cp.value;
        break;
      }
    }

    const jlptOld = ch.misc.jlptLevel ?? null;

    result.set(ch.literal, {
      literal: ch.literal,
      grade: ch.misc.grade ?? null,
      strokeCount: ch.misc.strokeCounts[0] || 0,
      frequencyRank: ch.misc.frequency ?? null,
      jlptOld,
      jlptLevel: mapJlptOldToNew(jlptOld),
      readingsOn,
      readingsKun,
      meanings,
      nanori,
      radicalClassical,
      radicalNelson,
      heisigIndex,
      unicodeCodepoint,
    });
  }

  console.log(`  Parsed ${result.size} kanji entries`);
  return result;
}
