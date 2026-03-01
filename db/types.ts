export interface DictEntry {
  id: number;
  common: boolean;
  jlptLevel: number | null;
  kanji: DictKanji[];
  kana: DictKana[];
  senses: DictSense[];
  pitchAccents: PitchAccent[];
}

export interface DictKanji {
  text: string;
  common: boolean;
  tags: string[];
}

export interface DictKana {
  text: string;
  romaji: string | null;
  common: boolean;
  tags: string[];
}

export interface DictSense {
  partOfSpeech: string[];
  glosses: Gloss[];
  field: string | null;
  misc: string | null;
  info: string | null;
}

export interface Gloss {
  lang: string;
  text: string;
}

export interface PitchAccent {
  reading: string;
  pitchNumber: number;
}

export interface EnglishMatchEntry {
  entry: DictEntry;
  matchedGloss: string;
}

export interface GlossGroup {
  gloss: string;
  entries: DictEntry[];
}

export interface SearchResults {
  japanese: DictEntry[];
  english: DictEntry[];
  englishMatches?: EnglishMatchEntry[];
}

// ─── Kanji types ───

export interface KanjiCharacter {
  literal: string;
  grade: number | null;
  strokeCount: number;
  frequencyRank: number | null;
  jlptOld: number | null;
  jlptLevel: number | null;
  readingsOn: string[];
  readingsKun: string[];
  meanings: string[];
  nanori: string[];
  radicalClassical: number | null;
  radicalNelson: number | null;
  heisigIndex: number | null;
  unicodeCodepoint: string;
  strokePaths: StrokePath[];
  heisigKeyword: string | null;
  heisigLesson: number | null;
}

export interface StrokePath {
  type: string;
  d: string;
}

export interface SimilarKanji {
  literal: string;
  score: number;
  rank: number;
}

// SRS card display modes
export type CardFace = "kanji" | "kana" | "english";

export type FlashcardMode = "add_order" | "simple_srs" | "srs";

export interface WordList {
  id: string;
  name: string;
  description: string | null;
  flashcardMode: FlashcardMode;
  frontFaces: CardFace[];
  backFaces: CardFace[];
  configured: boolean;
  studyPosition: number;
  autoPlayAudio: boolean;
  confusionDetection: boolean;
  voiceMode: boolean;
  typingMode: boolean;
  disableFlipAnimation: boolean;
  disableSwipeAnimation: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  entryCount?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  aozoraId: number | null;
  sourceId: string | null;
  source: "aozora" | "import" | "syosetu";
  rawContent: string | null;
  htmlContent: string | null;
  scrollPosition: number;
  fontSize: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
}

// Discriminated union for items in a list
export type ListItem =
  | { kind: "entry"; entry: DictEntry }
  | { kind: "kanji"; kanji: KanjiCharacter };

// Helper for unique keys in Sets/Maps
export function listItemKey(item: ListItem): string {
  return item.kind === "entry" ? `e:${item.entry.id}` : `k:${item.kanji.literal}`;
}

export interface SrsCardRow {
  id: string;
  entryId: number;
  kanjiLiteral: string | null;
  listId: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  frontMode: CardFace;
  backMode: CardFace;
  createdAt: string;
  updatedAt: string;
  // Simple SRS fields (nullable, only used in simple_srs mode)
  simpleStage: number | null;
  simpleN: number | null;
  simpleInterval: number | null;
  // Confusion detection cooldown
  lastConfusionCheck: string | null;
}
