import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";

// ─── Dictionary tables (read-only, bundled with app) ───

export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey(),
  common: integer("common", { mode: "boolean" }).notNull().default(false),
  priority: integer("priority").notNull().default(0),
});

export const kanji = sqliteTable("kanji", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id),
  text: text("text").notNull(),
  common: integer("common", { mode: "boolean" }).notNull().default(false),
  tags: text("tags"), // JSON array of tag codes e.g. ["oK","rK"]
});

export const kana = sqliteTable("kana", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id),
  text: text("text").notNull(),
  romaji: text("romaji"),
  common: integer("common", { mode: "boolean" }).notNull().default(false),
  tags: text("tags"), // JSON array of tag codes e.g. ["ok","ik"]
});

export const senses = sqliteTable("senses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id),
  partOfSpeech: text("part_of_speech"), // JSON array as string
  glosses: text("glosses").notNull(), // JSON array of {lang, text}
  field: text("field"), // domain (math, bio, etc.)
  misc: text("misc"), // usage notes
  info: text("info"),
});

export const pitchAccents = sqliteTable("pitch_accents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id),
  reading: text("reading").notNull(),
  pitchNumber: integer("pitch_number").notNull(), // 0=heiban, 1=atamadaka, etc.
});

// FTS virtual table for English gloss search (created via raw SQL in migrations)
// CREATE VIRTUAL TABLE glosses_fts USING fts5(glosses, entry_id UNINDEXED);

// ─── Kanji index tables (read-only, bundled with dictionary) ───

export const kanjiCharacters = sqliteTable("kanji_characters", {
  literal: text("literal").primaryKey(),
  grade: integer("grade"),
  strokeCount: integer("stroke_count").notNull(),
  frequencyRank: integer("frequency_rank"),
  jlptOld: integer("jlpt_old"),
  jlptLevel: integer("jlpt_level"),
  readingsOn: text("readings_on"), // JSON array
  readingsKun: text("readings_kun"), // JSON array
  meanings: text("meanings"), // JSON array
  nanori: text("nanori"), // JSON array
  radicalClassical: integer("radical_classical"),
  radicalNelson: integer("radical_nelson"),
  heisigIndex: integer("heisig_index"),
  unicodeCodepoint: text("unicode_codepoint").notNull(),
  strokePaths: text("stroke_paths"), // JSON array of {type, d}
  similarityVector: blob("similarity_vector"), // Float32Array as blob
});

export const kanjiRadicals = sqliteTable("kanji_radicals", {
  literal: text("literal").notNull(),
  radical: text("radical").notNull(),
});

export const kanjiSimilarity = sqliteTable("kanji_similarity", {
  literal: text("literal").notNull(),
  similar: text("similar").notNull(),
  score: real("score").notNull(),
  rank: integer("rank").notNull(),
});

// FTS virtual table for kanji meaning search (created via raw SQL in build)
// CREATE VIRTUAL TABLE kanji_meanings_fts USING fts5(meanings, literal UNINDEXED);

// ─── User data tables (separate DB, read-write) ───

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const listEntries = sqliteTable("list_entries", {
  id: text("id").primaryKey(), // UUID
  listId: text("list_id")
    .notNull()
    .references(() => lists.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").notNull(), // FK to dictionary entries.id
  addedAt: text("added_at").notNull(),
});

export const srsCards = sqliteTable("srs_cards", {
  id: text("id").primaryKey(), // UUID
  entryId: integer("entry_id").notNull(),
  listId: text("list_id").references(() => lists.id, { onDelete: "set null" }),
  // FSRS fields
  due: text("due").notNull(),
  stability: real("stability").notNull(),
  difficulty: real("difficulty").notNull(),
  elapsedDays: integer("elapsed_days").notNull(),
  scheduledDays: integer("scheduled_days").notNull(),
  reps: integer("reps").notNull(),
  lapses: integer("lapses").notNull(),
  state: integer("state").notNull(), // 0=New, 1=Learning, 2=Review, 3=Relearning
  lastReview: text("last_review"),
  // What to show on front/back
  frontMode: text("front_mode").notNull().default("kanji"), // kanji, kana, english
  backMode: text("back_mode").notNull().default("english"), // kanji, kana, english
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reviewLogs = sqliteTable("review_logs", {
  id: text("id").primaryKey(), // UUID
  cardId: text("card_id")
    .notNull()
    .references(() => srsCards.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1=Again, 2=Hard, 3=Good, 4=Easy
  state: integer("state").notNull(),
  due: text("due").notNull(),
  stability: real("stability").notNull(),
  difficulty: real("difficulty").notNull(),
  elapsedDays: integer("elapsed_days").notNull(),
  scheduledDays: integer("scheduled_days").notNull(),
  reviewedAt: text("reviewed_at").notNull(),
});
