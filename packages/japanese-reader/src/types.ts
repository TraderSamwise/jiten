export interface ReaderViewRef {
  postMessage: (data: string) => void;
  focus: () => void;
}

export interface ReaderViewProps {
  html: string;
  onMessage: (data: string) => void;
}

export type ReaderLookupMode = "word" | "name" | "auto";
export type ReaderLookupKind = "word" | "name";

export interface ReaderDictKanji {
  text: string;
  common: boolean;
  tags: string[];
}

export interface ReaderDictKana {
  text: string;
  romaji: string | null;
  common: boolean;
  tags: string[];
}

export interface ReaderGloss {
  lang: string;
  text: string;
}

export interface ReaderDictSense {
  partOfSpeech: string[];
  glosses: ReaderGloss[];
  field: string | null;
  misc: string | null;
  info: string | null;
}

export interface ReaderPitchAccent {
  reading: string;
  pitchNumber: number;
}

export interface ReaderDictEntry {
  id: number;
  common: boolean;
  jlptLevel: number | null;
  kanji: ReaderDictKanji[];
  kana: ReaderDictKana[];
  senses: ReaderDictSense[];
  pitchAccents: ReaderPitchAccent[];
}

export interface ReaderNameEntry {
  id: number;
  kanji: string | null;
  kana: string;
  nameType: string | null;
  translation: string | null;
}

export interface ReaderLookupResult {
  matchedText: string;
  entries: ReaderDictEntry[];
  deinflectReasons: string[];
  matchStart?: number;
  nameMatches?: ReaderNameEntry[];
  lookupKind?: ReaderLookupKind;
  alternateResults?: ReaderLookupResult[];
}

export type LookupResult = ReaderLookupResult;
export type LookupKind = ReaderLookupKind;

export type ReaderBookSourceKind = "aozora" | "import" | "syosetu" | "article";

export interface ReaderBookRecord {
  id: string;
  title: string;
  source: ReaderBookSourceKind;
  rawContent: string | null;
  scrollPosition: number;
  charOffset: number;
  totalChars: number;
  fontSize: number;
}

export interface ReaderBookmarkMembership {
  version: string;
  hasEntryId: (entryId: number) => boolean;
}
