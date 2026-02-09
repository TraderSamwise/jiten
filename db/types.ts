export interface DictEntry {
  id: number;
  common: boolean;
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

// SRS card display modes
export type CardFace = "kanji" | "kana" | "english";

export type FlashcardMode = "add_order" | "srs";

export interface WordList {
  id: string;
  name: string;
  description: string | null;
  flashcardMode: FlashcardMode;
  frontFaces: CardFace[];
  backFaces: CardFace[];
  configured: boolean;
  studyPosition: number;
  createdAt: string;
  updatedAt: string;
  entryCount?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  aozoraId: number | null;
  source: "aozora" | "import";
  rawContent: string | null;
  htmlContent: string | null;
  scrollPosition: number;
  fontSize: number;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
}

export interface SrsCardRow {
  id: string;
  entryId: number;
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
}
