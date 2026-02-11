/**
 * KanjiVG parser.
 *
 * Reads KanjiVG SVG files from a zip archive and extracts stroke path data
 * for each kanji character.
 *
 * KanjiVG format: Each kanji is a separate SVG file named by Unicode codepoint
 * (e.g. 04e00.svg for 一). The SVG contains <path> elements with stroke data.
 */

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

export interface StrokePath {
  type: string; // stroke type from kvg:type attribute (e.g. "㇐" for horizontal)
  d: string; // SVG path d-attribute
}

/**
 * Parse KanjiVG zip archive and extract stroke paths per kanji.
 *
 * @param zipPath - Path to the KanjiVG zip file
 * @returns Map from kanji literal to array of stroke paths
 */
export function parseKanjiVG(zipPath: string): Map<string, StrokePath[]> {
  console.log(`  Parsing KanjiVG from ${zipPath}...`);
  const result = new Map<string, StrokePath[]>();

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  let parsed = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.entryName);

    // KanjiVG files are named like "04e00.svg" or "04e00-Kaisho.svg"
    // We want the main files (no variant suffix, or just the base codepoint)
    if (!name.endsWith(".svg")) continue;

    // Extract codepoint from filename: "04e00.svg" → "4e00"
    const match = name.match(/^0?([0-9a-f]{4,5})\.svg$/i);
    if (!match) continue;

    const codepoint = parseInt(match[1], 16);
    if (isNaN(codepoint)) continue;

    const literal = String.fromCodePoint(codepoint);
    const svg = entry.getData().toString("utf-8");

    const strokes = extractStrokes(svg);
    if (strokes.length > 0) {
      result.set(literal, strokes);
      parsed++;
    } else {
      skipped++;
    }
  }

  console.log(`  Parsed ${parsed} kanji SVGs (${skipped} skipped)`);
  return result;
}

/**
 * Extract stroke paths from a KanjiVG SVG string.
 * Looks for <path> elements with d attributes.
 */
function extractStrokes(svg: string): StrokePath[] {
  const strokes: StrokePath[] = [];

  // Match <path> elements — KanjiVG uses self-closing <path ... />
  // The d attribute contains the stroke data
  const pathRegex = /<path[^>]*?\bd="([^"]+)"[^>]*?\/?>/g;
  const typeRegex = /kvg:type="([^"]+)"/;

  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(svg)) !== null) {
    const d = match[1];
    const fullTag = match[0];

    // Try to extract stroke type
    const typeMatch = typeRegex.exec(fullTag);
    const type = typeMatch ? typeMatch[1] : "";

    strokes.push({ type, d });
  }

  return strokes;
}

/**
 * Parse KanjiVG from an extracted directory of SVG files
 * (alternative to zip parsing, useful for development).
 */
export function parseKanjiVGDir(dirPath: string): Map<string, StrokePath[]> {
  console.log(`  Parsing KanjiVG from directory ${dirPath}...`);
  const result = new Map<string, StrokePath[]>();

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".svg"));

  for (const file of files) {
    const match = file.match(/^0?([0-9a-f]{4,5})\.svg$/i);
    if (!match) continue;

    const codepoint = parseInt(match[1], 16);
    if (isNaN(codepoint)) continue;

    const literal = String.fromCodePoint(codepoint);
    const svg = fs.readFileSync(path.join(dirPath, file), "utf-8");

    const strokes = extractStrokes(svg);
    if (strokes.length > 0) {
      result.set(literal, strokes);
    }
  }

  console.log(`  Parsed ${result.size} kanji SVGs from directory`);
  return result;
}
