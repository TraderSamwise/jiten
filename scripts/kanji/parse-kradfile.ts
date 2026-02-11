/**
 * KRADFILE parser.
 *
 * Parses the jmdict-simplified KRADFILE JSON format into a Map of
 * kanji → radical components.
 * Source: https://github.com/scriptin/jmdict-simplified
 */

import * as fs from "fs";

// jmdict-simplified KRADFILE JSON format: { "kanji": { "literal": ["radical", ...], ... } }
// Or it may be an array of entries. We handle both.
type KradfileRaw = Record<string, string[]> | { kanji: Record<string, string[]> };

export function parseKradfile(jsonPath: string): Map<string, string[]> {
  console.log(`  Parsing KRADFILE from ${jsonPath}...`);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  const result = new Map<string, string[]>();

  // jmdict-simplified kradfile format: top-level object mapping kanji → radical array
  // e.g. { "亜": ["｜","一","口"], "唖": ["｜","一","口","ア"], ... }
  const data: Record<string, string[]> = raw.kanji !== undefined ? raw.kanji : raw;

  for (const [kanji, radicals] of Object.entries(data)) {
    if (Array.isArray(radicals)) {
      result.set(kanji, radicals);
    }
  }

  console.log(`  Parsed ${result.size} kanji-radical mappings`);
  return result;
}
