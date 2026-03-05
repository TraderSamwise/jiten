import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import { applyFuriganaToHtml, type FuriganaEntry, type FuriganaKanjiSet } from "../reader-furigana";

const DB_PATH = path.resolve(__dirname, "../../assets/dictionary.db");

/** Build nonJouyou set the SAME way the real app does (via DB query) but filtering to real kanji */
function buildNonJouyouSet(db: Database.Database): FuriganaKanjiSet {
  const rows = db
    .prepare("SELECT literal FROM kanji_characters WHERE jlpt_level IS NULL")
    .all() as { literal: string }[];
  const chars = new Set<string>();
  for (const r of rows) {
    const code = r.literal.charCodeAt(0);
    // Only include actual CJK characters (matching isKanji in reader-furigana.ts)
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      chars.add(r.literal);
    }
  }
  return { all: false, chars };
}

/** Build nonJouyou set WITHOUT filtering — reproduces the bug */
function buildBuggyNonJouyouSet(db: Database.Database): FuriganaKanjiSet {
  const rows = db
    .prepare("SELECT literal FROM kanji_characters WHERE jlpt_level IS NULL")
    .all() as { literal: string }[];
  const chars = new Set(rows.map((r) => r.literal));
  return { all: false, chars };
}

describe("furigana nonJouyou filter", () => {
  it("buggy set includes kana — う is in set, causing false matches", () => {
    const db = new Database(DB_PATH, { readonly: true });
    const buggySet = buildBuggyNonJouyouSet(db);
    expect(buggySet.chars.has("う")).toBe(true); // the bug

    const fMap = new Map<string, FuriganaEntry>([
      ["吸う", { kanjiPart: "吸", reading: "す", kanjiPartLen: 1 }],
    ]);
    const result = applyFuriganaToHtml("<p>吸う。</p>", fMap, buggySet);
    expect(result).toContain("<ruby>"); // bug: incorrectly matches
    db.close();
  });

  it("filtered set excludes kana — 吸う should NOT get furigana with nonJouyou", () => {
    const db = new Database(DB_PATH, { readonly: true });
    const kanjiSet = buildNonJouyouSet(db);
    expect(kanjiSet.chars.has("う")).toBe(false);
    expect(kanjiSet.chars.has("吸")).toBe(false);

    const fMap = new Map<string, FuriganaEntry>([
      ["吸う", { kanjiPart: "吸", reading: "す", kanjiPartLen: 1 }],
      ["笑", { kanjiPart: "笑", reading: "わらい", kanjiPartLen: 1 }],
    ]);
    const result = applyFuriganaToHtml("<p>笑った。吸う。</p>", fMap, kanjiSet);
    expect(result).not.toContain("<ruby>");
    db.close();
  });
});
