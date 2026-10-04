import type { DictMigration } from "../migrate-dict";
import { fetchGlyphOrigins } from "../kanji/fetch-glyph-origin";

/**
 * Where a character came from, in one or two sentences — the hook Heisig's
 * invented stories replace. Scoped to the RTK frames, which is what the course
 * shows; the rest of the 13,000 kanji would triple the fetch for a page nobody
 * reaches from a frame.
 */
const migration: DictMigration = {
  version: 25,
  description: "Add Wiktionary glyph origin to the RTK frames",
  async migrate(db) {
    const cols = db.pragma("table_info(kanji_characters)") as { name: string }[];
    if (!cols.some((c) => c.name === "glyph_origin")) {
      console.log("  Adding glyph_origin column...");
      db.exec("ALTER TABLE kanji_characters ADD COLUMN glyph_origin TEXT");
    }

    // Lost when migration 020 rebuilt the table; the course asks for a lesson
    // at a time, and without it every such query reads 3,000 full rows.
    db.exec("DROP INDEX IF EXISTS idx_kc_heisig_lesson");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_kc_heisig_lesson ON kanji_characters(heisig_lesson, heisig_index)",
    );

    const rows = db
      .prepare(
        "SELECT literal FROM kanji_characters WHERE heisig_index IS NOT NULL ORDER BY heisig_index",
      )
      .all() as { literal: string }[];
    console.log(`  ${rows.length} frames to look up`);

    const origins = await fetchGlyphOrigins(rows.map((r) => r.literal));

    const update = db.prepare("UPDATE kanji_characters SET glyph_origin = ? WHERE literal = ?");
    const writeAll = db.transaction((entries: [string, string][]) => {
      for (const [literal, text] of entries) update.run(text, literal);
    });
    writeAll([...origins.entries()]);
    console.log(`  Wrote ${origins.size} glyph origins (${rows.length - origins.size} absent)`);
  },
};

export default migration;
