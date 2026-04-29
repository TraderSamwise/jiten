export type FuriganaMatchLevel = "n5" | "n4" | "n3" | "n2" | "n1" | "nonJouyou";

export type ReaderFuriganaRule =
  | "matchAnyKanji"
  | "matchWordLevel"
  | "matchIrregularReading"
  | "matchMostlyKunyomi"
  | "matchMostlyOnyomi"
  | "matchMixedOnKun";

export interface FuriganaKanjiSet {
  all: boolean;
  chars: Set<string>;
}

export interface ReaderFuriganaSettings {
  sourceDefault: boolean;
  showNames: boolean;
  showCounters: boolean;
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>;
}

export interface FuriganaEntry {
  kanjiPart: string;
  reading: string;
  kanjiPartLen: number;
  wordJlpt?: number;
  irregularReading?: boolean;
  isName?: boolean;
  isCounter?: boolean;
  fullKanjiForm?: string;
  fullKanaForm?: string;
  readingPattern?: "mostly_onyomi" | "mostly_kunyomi" | "mixed_on_kun" | "irregular" | "unknown";
}

export const defaultFuriganaMatchLevels: Record<FuriganaMatchLevel, boolean> = {
  n5: false,
  n4: false,
  n3: false,
  n2: false,
  n1: false,
  nonJouyou: false,
};

export const defaultReaderFuriganaRuleLevels: Record<
  ReaderFuriganaRule,
  Record<FuriganaMatchLevel, boolean>
> = {
  matchAnyKanji: { ...defaultFuriganaMatchLevels },
  matchWordLevel: { ...defaultFuriganaMatchLevels },
  matchIrregularReading: { ...defaultFuriganaMatchLevels },
  matchMostlyKunyomi: { ...defaultFuriganaMatchLevels },
  matchMostlyOnyomi: { ...defaultFuriganaMatchLevels },
  matchMixedOnKun: { ...defaultFuriganaMatchLevels },
};

export const defaultReaderFuriganaSettings: ReaderFuriganaSettings = {
  sourceDefault: true,
  showNames: false,
  showCounters: false,
  ruleLevels: defaultReaderFuriganaRuleLevels,
};
