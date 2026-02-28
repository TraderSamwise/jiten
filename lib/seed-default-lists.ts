import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "@/db/user-db";

const FLAG_KEY = "default_lists_seeded";

interface ListDef {
  name: string;
  column: "jlpt_level" | "grade";
  value: number;
}

const LIST_DEFS: ListDef[] = [
  { name: "JLPT N5 Kanji", column: "jlpt_level", value: 5 },
  { name: "JLPT N4 Kanji", column: "jlpt_level", value: 4 },
  { name: "JLPT N3 Kanji", column: "jlpt_level", value: 3 },
  { name: "JLPT N2 Kanji", column: "jlpt_level", value: 2 },
  { name: "JLPT N1 Kanji", column: "jlpt_level", value: 1 },
  { name: "Jouyou Grade 1", column: "grade", value: 1 },
  { name: "Jouyou Grade 2", column: "grade", value: 2 },
  { name: "Jouyou Grade 3", column: "grade", value: 3 },
  { name: "Jouyou Grade 4", column: "grade", value: 4 },
  { name: "Jouyou Grade 5", column: "grade", value: 5 },
  { name: "Jouyou Grade 6", column: "grade", value: 6 },
];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export async function seedDefaultListsIfNeeded(
  userDb: WrappedUserDb,
  dictDb: SQLite.SQLiteDatabase,
): Promise<boolean> {
  // Check if already seeded
  const flag = await userDb.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [FLAG_KEY],
  );
  if (flag) return false;

  const now = new Date().toISOString();

  // Fetch all kanji grouped by list definition
  for (const def of LIST_DEFS) {
    const literals = await dictDb.getAllAsync<{ literal: string }>(
      `SELECT literal FROM kanji_characters WHERE ${def.column} = ? ORDER BY frequency_rank IS NULL, frequency_rank`,
      [def.value],
    );

    if (literals.length === 0) continue;

    const listId = generateId();

    // Create the list
    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [listId, def.name, null, now, now],
    );

    // Insert all kanji entries in batches to avoid overly large statements
    const BATCH_SIZE = 200;
    for (let i = 0; i < literals.length; i += BATCH_SIZE) {
      const batch = literals.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "(?, ?, 0, ?, ?)").join(", ");
      const params: (string | number)[] = [];
      for (const row of batch) {
        params.push(generateId(), listId, now, row.literal);
      }
      await userDb.runAsync(
        `INSERT INTO list_entries (id, list_id, entry_id, added_at, kanji_literal) VALUES ${placeholders}`,
        params,
      );
    }
  }

  // Mark as seeded
  await userDb.runAsync("INSERT INTO app_flags (key, value) VALUES (?, ?)", [FLAG_KEY, "1"]);

  return true;
}
