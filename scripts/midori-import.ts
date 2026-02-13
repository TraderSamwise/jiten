/**
 * Midori → Jiten Import Script
 *
 * Reads Midori's bookmark3 database and produces .jiten JSON files
 * that can be imported into jiten with simple SRS data preserved.
 *
 * Usage: npx tsx scripts/midori-import.ts [--folder <number>] [--output <dir>]
 *
 * Options:
 *   [path]          Path to bookmark3 database. Default: Midori's container path.
 *   --folder <n>    Only export a specific folder (1-4). Default: all folders.
 *   --output <dir>  Output directory. Default: current directory.
 *   --verify        Verify entry IDs exist in jiten's dictionary.db
 */

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

import type { JitenExportFile } from "../lib/list-transfer";

const DEFAULT_BOOKMARK_DB = path.join(
  os.homedir(),
  "Library/Containers/101C13F5-F64C-44F0-99A6-D12850F4D343/Data/Documents/bookmark3",
);

// ─── Helpers ───

/** Parse Midori's non-standard JSON: {s:1,n:8951.5938,l:365.0000} */
function parseMidoriJson(raw: string): { s: number; n: number; l: number } | null {
  const fixed = raw.replace(/(\w+):/g, '"$1":');
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

// ─── Parse CLI args ───

const args = process.argv.slice(2);
let bookmarkDbPath: string | null = null;
let folderFilter: number | null = null;
let outputDir = ".";
let verify = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--folder" && args[i + 1]) {
    folderFilter = parseInt(args[++i], 10);
  } else if (args[i] === "--output" && args[i + 1]) {
    outputDir = args[++i];
  } else if (args[i] === "--verify") {
    verify = true;
  } else if (!args[i].startsWith("--")) {
    bookmarkDbPath = args[i];
  }
}

const BOOKMARK_DB = bookmarkDbPath ?? DEFAULT_BOOKMARK_DB;

// ─── Main ───

function main() {
  console.log("=== Midori → Jiten Import ===\n");

  const bookmarkDb = new Database(BOOKMARK_DB, { readonly: true });

  // Get folder names
  const folderRows = bookmarkDb.prepare("SELECT rowid, name FROM folder").all() as {
    rowid: number;
    name: string;
  }[];
  const folderNames = new Map(folderRows.map((f) => [f.rowid, f.name]));

  // Determine which folders to export
  const foldersToExport = folderFilter ? [folderFilter] : folderRows.map((f) => f.rowid);

  // Optional: load dictionary for verification
  let dictDb: Database.Database | null = null;
  if (verify) {
    const dictPaths = [
      path.join(process.cwd(), "assets", "dictionary.db"),
      "/Applications/Midori.app/Wrapper/Midori.app/db",
    ];
    for (const p of dictPaths) {
      try {
        dictDb = new Database(p, { readonly: true });
        console.log(`Dictionary loaded from: ${p}`);
        break;
      } catch {
        // Try next
      }
    }
    if (!dictDb) {
      console.log("Warning: Could not load dictionary for verification\n");
    }
  }

  for (const folderId of foldersToExport) {
    const folderName = folderNames.get(folderId) ?? `Folder ${folderId}`;
    console.log(`\nProcessing folder ${folderId}: "${folderName}"...`);

    // Get all bookmarks in this folder
    const bookmarks = bookmarkDb
      .prepare("SELECT rowid, id2, d FROM bookmark WHERE folder = ? ORDER BY rowid ASC")
      .all(folderId) as { rowid: number; id2: string; d: string | null }[];

    console.log(`  Total bookmarks: ${bookmarks.length}`);

    // Parse SRS data
    const entries: {
      entryId: number;
      addedAt: string;
      srs: { s: number; n: number; l: number } | null;
    }[] = [];
    let srsCount = 0;
    let skipCount = 0;

    for (const bm of bookmarks) {
      const entryId = parseInt(bm.id2, 10);
      if (isNaN(entryId)) {
        skipCount++;
        continue;
      }

      let srs: { s: number; n: number; l: number } | null = null;
      if (bm.d && bm.d.length > 0) {
        srs = parseMidoriJson(bm.d);
        if (srs) srsCount++;
      }

      entries.push({
        entryId,
        addedAt: new Date().toISOString(), // Midori doesn't store add dates
        srs,
      });
    }

    console.log(`  With SRS data: ${srsCount}`);
    if (skipCount > 0) console.log(`  Skipped (non-numeric id2): ${skipCount}`);

    // Verify against dictionary
    if (dictDb) {
      let verified = 0;
      let missing = 0;
      for (const e of entries) {
        const row = dictDb.prepare("SELECT id FROM entries WHERE id = ?").get(e.entryId) as any;
        if (row) {
          verified++;
        } else {
          missing++;
          if (missing <= 5) {
            console.log(`  Warning: entry ${e.entryId} not found in dictionary`);
          }
        }
      }
      console.log(`  Verified: ${verified}/${entries.length} (${missing} missing)`);
    }

    // Build jiten export file
    const srsCards = entries
      .filter((e) => e.srs !== null)
      .map((e) => ({
        entryId: e.entryId,
        stage: e.srs!.s,
        n: e.srs!.n,
        interval: e.srs!.l,
      }));

    const exportFile: JitenExportFile = {
      format: "jiten-list-v1",
      exportedAt: new Date().toISOString(),
      list: {
        name: folderName,
        description: `Imported from Midori folder "${folderName}"`,
        flashcardMode: "simple_srs",
        frontFaces: ["kanji"],
        backFaces: ["english"],
        autoPlayAudio: false,
      },
      entries: entries.map((e) => ({
        entryId: e.entryId,
        addedAt: e.addedAt,
      })),
      simpleSrsData: {
        studyPosition: srsCount, // Number of cards that have been reviewed
        cards: srsCards,
      },
    };

    // Write output
    const safeName = folderName.replace(/[^a-zA-Z0-9]/g, "_");
    fs.mkdirSync(outputDir, { recursive: true });
    const outPath = path.join(outputDir, `midori_${safeName}.jiten`);
    fs.writeFileSync(outPath, JSON.stringify(exportFile, null, 2));
    console.log(`  Written to: ${outPath}`);
    console.log(`  Entries: ${entries.length}, SRS cards: ${srsCards.length}`);
  }

  bookmarkDb.close();
  dictDb?.close();

  console.log("\n=== Done ===");
  console.log("Import these .jiten files using the import feature in jiten.");
}

main();
