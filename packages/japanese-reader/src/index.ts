export type { JapaneseReaderBackend, ReaderBookSource, ReaderSqlDb } from "./backend";
export {
  applyBookmarkHighlightsToHtml,
  applyResolvedBookmarkHighlightsToHtml,
  resolveBookmarkedWordSurfacesInHtml,
} from "./bookmarks";
export {
  applyFuriganaToHtml,
  buildFuriganaKanjiSet,
  extractSurfacesFromHtml,
  injectRubySpacers,
  resolveFuriganaBatch,
  serializeKanjiSet,
} from "./furigana";
export {
  defaultFuriganaMatchLevels,
  defaultReaderFuriganaRuleLevels,
  defaultReaderFuriganaSettings,
} from "./furigana-types";
export { getSelectionToolbarPosition } from "@tradersamwise/jiten-reader-core";
export {
  autoLookup,
  autoLookupWithOffset,
  autoSelectionLookup,
  chooseAutoLookupResults,
  decomposeWord,
  nameLookup,
  nameLookupWithOffset,
  selectionLookup,
  smartLookup,
  smartLookupWithOffset,
} from "./lookup";
export { useJapaneseReader } from "./use-japanese-reader";
export type {
  ReaderBookRecord,
  ReaderBookmarkMembership,
  ReaderDictEntry,
  ReaderDictKana,
  ReaderDictKanji,
  ReaderDictSense,
  ReaderGloss,
  LookupKind,
  LookupResult,
  ReaderLookupKind,
  ReaderLookupMode,
  ReaderLookupResult,
  ReaderNameEntry,
  ReaderPitchAccent,
  ReaderViewProps,
  ReaderViewRef,
} from "./types";
export type {
  FuriganaEntry,
  FuriganaKanjiSet,
  FuriganaMatchLevel,
  ReaderFuriganaRule,
  ReaderFuriganaSettings,
} from "./furigana-types";
export type {
  JapaneseReaderSettings,
  JapaneseReaderSettingsActions,
  JapaneseReaderSettingsDraft,
  ReaderLoadingState,
  ReaderSelectionTooltip,
  UseJapaneseReaderOptions,
  UseJapaneseReaderResult,
} from "./use-japanese-reader";
