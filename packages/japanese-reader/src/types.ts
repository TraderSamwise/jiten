export interface ReaderViewRef {
  postMessage: (data: string) => void;
  focus: () => void;
}

export interface ReaderViewProps {
  html: string;
  onMessage: (data: string) => void;
  // Fired when the platform destroys the webview document out from under us.
  onContentProcessTerminated?: () => void;
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
  /**
   * How often this spelling is read this way when it names a person, or null
   * where nothing was observed. Comparable only against other readings of the
   * SAME spelling — see docs/reader-lookup-decisions.md.
   */
  freq?: number | null;
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
  readComplete?: boolean;
  saved?: number;
}

export interface ReaderBookmarkMembership {
  version: string;
  hasEntryId: (entryId: number) => boolean;
}

/**
 * The readings this book has been told to use, keyed on the kanji run as the
 * page spells it. The empty reading means "show no furigana over this run".
 *
 * A port rather than a table, like `ReaderBookSource`: the package never
 * learns that the app keeps these in SQLite.
 */
export interface ReaderFuriganaPins {
  list: (bookId: string) => Promise<Map<string, string>>;
  set: (bookId: string, surface: string, reading: string) => Promise<void>;
  clear: (bookId: string, surface: string) => Promise<void>;
  clearAll: (bookId: string) => Promise<void>;
}
