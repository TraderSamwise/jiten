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
  heisigKeyword: text("heisig_keyword"),
  heisigLesson: integer("heisig_lesson"),
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

export const wordAudio = sqliteTable("word_audio", {
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id),
  reading: text("reading").notNull(),
  audio: blob("audio").notNull(),
  source: text("source").notNull(), // 'kanji_alive', 'tofugu', 'tts'
  format: text("format").notNull(), // 'mp3'
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
  flashcardMode: text("flashcard_mode").notNull().default("add_order"),
  frontFaces: text("front_faces").notNull().default('["kanji"]'), // JSON array
  backFaces: text("back_faces").notNull().default('["english"]'), // JSON array
  studyPosition: integer("study_position").notNull().default(0),
  configured: integer("configured").notNull().default(0),
  autoPlayAudio: integer("auto_play_audio").notNull().default(0),
  confusionDetection: integer("confusion_detection").notNull().default(1),
  voiceMode: integer("voice_mode").notNull().default(0),
  typingMode: integer("typing_mode").notNull().default(0),
  disableFlipAnimation: integer("disable_flip_animation").notNull().default(0),
  disableSwipeAnimation: integer("disable_swipe_animation").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0),
  deletedAt: text("deleted_at"),
  learningSteps: text("learning_steps"), // JSON array or null
  relearningSteps: text("relearning_steps"), // JSON array or null
});

export const listEntries = sqliteTable("list_entries", {
  id: text("id").primaryKey(), // UUID
  listId: text("list_id")
    .notNull()
    .references(() => lists.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").notNull(), // FK to dictionary entries.id (0 = kanji sentinel)
  addedAt: text("added_at").notNull(),
  kanjiLiteral: text("kanji_literal"), // set when this is a kanji entry (entry_id = 0)
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const srsCards = sqliteTable("srs_cards", {
  id: text("id").primaryKey(), // UUID
  entryId: integer("entry_id").notNull(), // 0 = kanji sentinel
  kanjiLiteral: text("kanji_literal"), // set when this is a kanji card (entry_id = 0)
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
  // Simple SRS fields (alternative algorithm)
  simpleStage: integer("simple_stage"),
  simpleN: real("simple_n"),
  simpleInterval: real("simple_interval"),
  lastConfusionCheck: text("last_confusion_check"),
  deletedAt: text("deleted_at"),
  learningSteps: integer("learning_steps").notNull().default(0),
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

export const practiceEvents = sqliteTable("practice_events", {
  id: text("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  kanjiLiteral: text("kanji_literal"),
  listId: text("list_id"),
  practiceMode: text("practice_mode").notNull(),
  correct: integer("correct").notNull(),
  responseMs: integer("response_ms"),
  typedAnswer: text("typed_answer"),
  reviewedAt: text("reviewed_at").notNull(),
  sessionId: text("session_id"),
  assisted: integer("assisted"),
});

export const practiceSessions = sqliteTable("practice_sessions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  listId: text("list_id"),
  practiceMode: text("practice_mode").notNull(),
  startedAt: text("started_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  totalItems: integer("total_items").notNull(),
  correctCount: integer("correct_count").notNull(),
});

export const confusionPairs = sqliteTable("confusion_pairs", {
  id: text("id").primaryKey(),
  entryIdA: integer("entry_id_a").notNull(),
  kanjiLiteralA: text("kanji_literal_a"),
  entryIdB: integer("entry_id_b").notNull(),
  kanjiLiteralB: text("kanji_literal_b"),
  confusionType: text("confusion_type").notNull(),
  confusionCount: integer("confusion_count").notNull().default(1),
  lastConfusedAt: text("last_confused_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const confusionEvents = sqliteTable("confusion_events", {
  id: text("id").primaryKey(),
  entryIdA: integer("entry_id_a").notNull(),
  kanjiLiteralA: text("kanji_literal_a"),
  entryIdB: integer("entry_id_b").notNull(),
  kanjiLiteralB: text("kanji_literal_b"),
  confusionType: text("confusion_type").notNull(),
  listId: text("list_id"),
  practiceMode: text("practice_mode"),
  confusedAt: text("confused_at").notNull(),
});

export const gameScores = sqliteTable("game_scores", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  gameType: text("game_type").notNull(),
  gameMode: text("game_mode").notNull(),
  speedPreset: text("speed_preset").notNull(),
  score: integer("score").notNull(),
  matchesMade: integer("matches_made").notNull(),
  triplesMade: integer("triples_made").notNull(),
  maxCombo: integer("max_combo").notNull(),
  accuracy: integer("accuracy").notNull(),
  durationMs: integer("duration_ms").notNull(),
  playedAt: text("played_at").notNull(),
});

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  aozoraId: integer("aozora_id"),
  source: text("source").notNull().default("import"),
  sourceId: text("source_id"),
  rawContent: text("raw_content"),
  htmlContent: text("html_content"),
  scrollPosition: real("scroll_position").notNull().default(0),
  fontSize: integer("font_size").notNull().default(22),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastReadAt: text("last_read_at"),
  isDefault: integer("is_default").notNull().default(0),
  charOffset: integer("char_offset").notNull().default(0),
  totalChars: integer("total_chars").notNull().default(0),
  deletedAt: text("deleted_at"),
  saved: integer("saved").notNull().default(1),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  readComplete: integer("read_complete").notNull().default(0),
});

export const userKanjiNotes = sqliteTable("user_kanji_notes", {
  literal: text("literal").primaryKey(),
  mnemonic: text("mnemonic").notNull(),
  updatedAt: text("updated_at").notNull(),
  keyword: text("keyword"),
  deletedAt: text("deleted_at"),
});

export const appFlags = sqliteTable("app_flags", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at"),
});

export const syncMeta = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const reviewMarks = sqliteTable("review_marks", {
  id: text("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  kanjiLiteral: text("kanji_literal"),
  listId: text("list_id"),
  markedAt: text("marked_at").notNull(),
});
