import type * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "@/db/user-db";
import { STARTER_BOOK_CONTENT } from "@/lib/starter-book-content";

const FLAG_KEY = "default_lists_seeded";
const VOCAB_FLAG_KEY = "default_vocab_lists_seeded";
const BOOK_FLAG_KEY = "default_book_seeded";

interface KanjiListDef {
  name: string;
  column: "jlpt_level" | "grade";
  value: number;
}

interface VocabListDef {
  name: string;
  jlptLevel: number;
}

const KANJI_LIST_DEFS: KanjiListDef[] = [
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

const VOCAB_LIST_DEFS: VocabListDef[] = [
  { name: "JLPT N5 Words", jlptLevel: 5 },
  { name: "JLPT N4 Words", jlptLevel: 4 },
  { name: "JLPT N3 Words", jlptLevel: 3 },
  { name: "JLPT N2 Words", jlptLevel: 2 },
  { name: "JLPT N1 Words", jlptLevel: 1 },
];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export async function seedDefaultListsIfNeeded(
  userDb: WrappedUserDb,
  dictDb: SQLite.SQLiteDatabase,
): Promise<boolean> {
  let seeded = false;

  // Seed kanji lists
  const kanjiFlag = await userDb.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [FLAG_KEY],
  );
  if (!kanjiFlag) {
    await seedKanjiLists(userDb, dictDb);
    await userDb.runAsync("INSERT INTO app_flags (key, value) VALUES (?, ?)", [FLAG_KEY, "1"]);
    seeded = true;
  }

  // Seed vocab lists (separate flag so existing users also get them)
  const vocabFlag = await userDb.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [VOCAB_FLAG_KEY],
  );
  if (!vocabFlag) {
    await seedVocabLists(userDb, dictDb);
    await userDb.runAsync("INSERT INTO app_flags (key, value) VALUES (?, ?)", [
      VOCAB_FLAG_KEY,
      "1",
    ]);
    seeded = true;
  }

  return seeded;
}

async function seedKanjiLists(userDb: WrappedUserDb, dictDb: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();

  for (const def of KANJI_LIST_DEFS) {
    const literals = await dictDb.getAllAsync<{ literal: string }>(
      `SELECT literal FROM kanji_characters WHERE ${def.column} = ? ORDER BY frequency_rank IS NULL, frequency_rank`,
      [def.value],
    );

    if (literals.length === 0) continue;

    const listId = generateId();

    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [listId, def.name, null, now, now],
    );

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
}

export async function seedDefaultBookIfNeeded(userDb: WrappedUserDb): Promise<void> {
  const flag = await userDb.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_flags WHERE key = ?",
    [BOOK_FLAG_KEY],
  );
  if (flag) return;

  const now = new Date().toISOString();
  const id = generateId();

  await userDb.runAsync(
    `INSERT INTO books (id, title, author, source, aozora_id, source_id, raw_content, is_default, created_at, updated_at)
     VALUES (?, ?, ?, 'aozora', ?, ?, ?, 1, ?, ?)`,
    [id, "夢十夜", "夏目漱石", 799, "799", STARTER_BOOK_CONTENT, now, now],
  );

  await userDb.runAsync("INSERT INTO app_flags (key, value) VALUES (?, ?)", [BOOK_FLAG_KEY, "1"]);
}

async function seedVocabLists(userDb: WrappedUserDb, dictDb: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();

  for (const def of VOCAB_LIST_DEFS) {
    let entries: { id: number }[];
    try {
      entries = await dictDb.getAllAsync<{ id: number }>(
        `SELECT id FROM entries WHERE jlpt_level = ? ORDER BY priority DESC`,
        [def.jlptLevel],
      );
    } catch {
      // jlpt_level column may not exist in older dict DBs — skip
      return;
    }

    if (entries.length === 0) continue;

    const listId = generateId();

    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [listId, def.name, null, now, now],
    );

    const BATCH_SIZE = 200;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "(?, ?, ?, ?)").join(", ");
      const params: (string | number)[] = [];
      for (const row of batch) {
        params.push(generateId(), listId, row.id, now);
      }
      await userDb.runAsync(
        `INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES ${placeholders}`,
        params,
      );
    }
  }
}
