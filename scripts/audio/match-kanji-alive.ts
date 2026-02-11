/**
 * Match Kanji Alive audio files to dictionary entry IDs.
 *
 * Kanji Alive provides a CSV (ka_data.csv) with example words per kanji,
 * plus audio files for those example words.
 */

import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";

export interface AudioMatch {
  entryId: number;
  reading: string;
  filePath: string;
  source: "kanji_alive";
}

interface KanjiAliveExample {
  kanji: string;
  reading: string;
  audioFile: string;
}

/**
 * Parse Kanji Alive data and match example word audio to dictionary entries.
 */
export function matchKanjiAlive(
  db: Database.Database,
  kanjiAliveDir: string,
  alreadyMatched: Set<number>,
): AudioMatch[] {
  const audioDir = path.join(kanjiAliveDir, "audio");
  const csvPath = path.join(kanjiAliveDir, "ka_data.csv");

  if (!fs.existsSync(csvPath)) {
    console.log("  Kanji Alive CSV not found, skipping");
    return [];
  }

  // Parse CSV to extract example words with audio
  const examples = parseKanjiAliveCSV(csvPath, audioDir);
  console.log(`  Found ${examples.length} Kanji Alive example words with audio`);

  const lookupByKanjiKana = db.prepare(`
    SELECT e.id as entry_id, kn.text as kana_text
    FROM entries e
    JOIN kanji k ON k.entry_id = e.id
    JOIN kana kn ON kn.entry_id = e.id
    WHERE k.text = ? AND kn.text = ?
    LIMIT 1
  `);

  const matches: AudioMatch[] = [];

  for (const example of examples) {
    const row = lookupByKanjiKana.get(example.kanji, example.reading) as
      | { entry_id: number; kana_text: string }
      | undefined;
    if (row && !alreadyMatched.has(row.entry_id)) {
      matches.push({
        entryId: row.entry_id,
        reading: row.kana_text,
        filePath: example.audioFile,
        source: "kanji_alive",
      });
      alreadyMatched.add(row.entry_id);
    }
  }

  console.log(`  Matched ${matches.length} Kanji Alive files to entries`);
  return matches;
}

/**
 * Parse Kanji Alive ka_data.csv.
 *
 * The CSV has columns for example words in the format:
 * kanji, onyomi, kunyomi, examples...
 * Example word columns contain: "word(reading): meaning"
 */
function parseKanjiAliveCSV(csvPath: string, audioDir: string): KanjiAliveExample[] {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const examples: KanjiAliveExample[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    // Kanji Alive CSV has example columns starting at various positions
    // Each example has format: word(reading): meaning
    for (const field of fields) {
      const exMatch = field.match(/^(.+?)\((.+?)\)/);
      if (!exMatch) continue;

      const [, word, reading] = exMatch;
      // Convert reading from katakana to hiragana if needed
      const hiraganaReading = katakanaToHiragana(reading);

      // Look for matching audio file
      const audioPatterns = [
        path.join(audioDir, `${word}.mp3`),
        path.join(audioDir, `${word}[${reading}].mp3`),
      ];

      // Also search recursively in subdirectories
      const audioFile = audioPatterns.find((p) => fs.existsSync(p));
      if (audioFile) {
        examples.push({
          kanji: word,
          reading: hiraganaReading,
          audioFile,
        });
      }
    }
  }

  return examples;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
