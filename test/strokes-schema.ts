import type Database from "better-sqlite3";

/** DDL for the strokes-tier `primitives` table, shared by db tests that LEFT JOIN it. */
export function createPrimitivesTable(db: Database.Database): void {
  db.exec(
    "CREATE TABLE primitives (id INTEGER PRIMARY KEY, keyword TEXT, display_glyph TEXT, real_glyph TEXT, strokes INTEGER);",
  );
}
