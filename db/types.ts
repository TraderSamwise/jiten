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
}

export interface DictKana {
  text: string;
  romaji: string | null;
  common: boolean;
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

// SRS card display modes
export type CardFace = "kanji" | "kana" | "english";

export interface WordList {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  entryCount?: number;
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
