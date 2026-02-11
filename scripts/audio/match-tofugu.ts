/**
 * Match Tofugu audio files to dictionary entry IDs.
 *
 * Tofugu filenames follow the pattern: 漢字【かな】.mp3
 * We parse these to extract kanji + reading, then look up matching entries.
 */

import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";

export interface AudioMatch {
  entryId: number;
  reading: string;
  filePath: string;
  source: "tofugu";
}

/**
 * Parse Tofugu audio filenames and match them to dictionary entries.
 * Returns matched audio files with their entry IDs.
 */
export function matchTofugu(db: Database.Database, tofuguDir: string): AudioMatch[] {
  if (!fs.existsSync(tofuguDir)) {
    console.log("  Tofugu directory not found, skipping");
    return [];
  }

  const files = fs.readdirSync(tofuguDir).filter((f) => f.endsWith(".mp3"));
  console.log(`  Found ${files.length} Tofugu audio files`);

  const lookupByKanjiKana = db.prepare(`
    SELECT e.id as entry_id, kn.text as kana_text
    FROM entries e
    JOIN kanji k ON k.entry_id = e.id
    JOIN kana kn ON kn.entry_id = e.id
    WHERE k.text = ? AND kn.text = ?
    LIMIT 1
  `);

  const lookupByKana = db.prepare(`
    SELECT e.id as entry_id, kn.text as kana_text
    FROM entries e
    JOIN kana kn ON kn.entry_id = e.id
    LEFT JOIN kanji k ON k.entry_id = e.id
    WHERE k.id IS NULL AND kn.text = ?
    LIMIT 1
  `);

  const matches: AudioMatch[] = [];
  const matchedEntryIds = new Set<number>();

  for (const file of files) {
    const basename = file.replace(/\.mp3$/, "");

    // Pattern: 漢字【かな】
    const bracketMatch = basename.match(/^(.+)【(.+)】$/);
    if (bracketMatch) {
      const [, kanjiText, kanaText] = bracketMatch;
      const row = lookupByKanjiKana.get(kanjiText, kanaText) as
        | { entry_id: number; kana_text: string }
        | undefined;
      if (row && !matchedEntryIds.has(row.entry_id)) {
        matches.push({
          entryId: row.entry_id,
          reading: row.kana_text,
          filePath: path.join(tofuguDir, file),
          source: "tofugu",
        });
        matchedEntryIds.add(row.entry_id);
      }
    } else {
      // Kana-only filename (no kanji form)
      const row = lookupByKana.get(basename) as { entry_id: number; kana_text: string } | undefined;
      if (row && !matchedEntryIds.has(row.entry_id)) {
        matches.push({
          entryId: row.entry_id,
          reading: row.kana_text,
          filePath: path.join(tofuguDir, file),
          source: "tofugu",
        });
        matchedEntryIds.add(row.entry_id);
      }
    }
  }

  console.log(`  Matched ${matches.length} Tofugu files to entries`);
  return matches;
}
