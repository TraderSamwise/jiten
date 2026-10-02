import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions } from "react-native";
import {
  calcCharsPerPage,
  type BookFormat,
  generateReaderHtml,
  getReaderProgressFlushMode,
  hasAozoraMarkup,
  isBookFinished,
  parseAozoraToHtml,
  parseBookContent,
  plainTextToHtml,
  sliceContent,
  stripAozoraBoilerplate,
  type TextModel,
} from "@tradersamwise/jiten-reader-core";
import type { JapaneseReaderBackend, ReaderBookSource } from "./backend";
import { truncateHtmlAtVisibleChars } from "./html-slice";
import {
  type BookmarkRunPlacements,
  type BookmarkSurfaceProvenance,
  bookmarksInsideSpan,
  matchBookmarksInHtml,
} from "./bookmarks";
import {
  applyFuriganaToHtml,
  buildFuriganaKanjiSet,
  extractSurfacesFromHtml,
  injectRubySpacers,
  applyFuriganaPinsToSourceRuby,
  resolveFuriganaBatch,
  type FuriganaEntry,
  type FuriganaKanjiSet,
} from "./furigana";
import { furiganaReadingCandidates, type FuriganaReadingCandidate } from "./furigana-pins";
import type { FuriganaMatchLevel, ReaderFuriganaRule } from "./furigana-types";
import {
  autoLookup,
  autoLookupWithOffset,
  autoSelectionLookup,
  nameLookup,
  nameLookupWithOffset,
  selectionLookup,
  smartLookup,
  smartLookupWithOffset,
} from "./lookup";
import { lookupEntriesByIds } from "./lookup-db";
import type {
  LookupResult,
  ReaderBookRecord,
  ReaderBookmarkMembership,
  ReaderLookupMode,
  ReaderViewProps,
  ReaderViewRef,
} from "./types";

type ReaderLoadStage = "preparing" | "parsing" | "generatingPages" | "generatingFurigana";

const READER_LOAD_STAGE_META: Record<ReaderLoadStage, { title: string; detail: string }> = {
  preparing: { title: "Preparing reader", detail: "Loading book data" },
  parsing: { title: "Parsing book", detail: "Reading and normalizing content" },
  generatingPages: {
    title: "Generating pages",
    detail: "Building the current reading slice",
  },
  generatingFurigana: {
    title: "Generating furigana",
    detail: "Applying reading annotations",
  },
};

const READER_LOAD_STEP_DURATION_MS = 1000;
const READ_PROGRESS_FLUSH_MS = 15_000;
const READER_LOAD_DISMISS_DELAY_MS = 220;
const SLICE_RENDER_CACHE_LIMIT = 48;
const TAP_TOOLTIP_FALLBACK_MS = 1000;
const warnedKeys = new Set<string>();

export interface JapaneseReaderSettings {
  pageAnimations: boolean;
  sourceFuriganaEnabled: boolean;
  readerCounterFurigana: boolean;
  readerNameFurigana: boolean;
  readerBookmarkHighlights: boolean;
  furiganaRuleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>;
}

export interface JapaneseReaderSettingsDraft extends JapaneseReaderSettings {
  fontSize: number;
}

export interface JapaneseReaderSettingsActions {
  setPageAnimations: (value: boolean) => void;
  setSourceFuriganaEnabled: (value: boolean) => void;
  setReaderCounterFurigana: (value: boolean) => void;
  setReaderNameFurigana: (value: boolean) => void;
  setReaderBookmarkHighlights: (value: boolean) => void;
  setFuriganaRuleLevels: (
    value: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  ) => void;
}

export interface ReaderSelectionTooltip {
  text: string;
  /** Reader-viewport coordinates anchored to the selected text bounds. */
  x: number;
  y: number;
}

export interface ReaderLoadingState {
  runId: number;
  visible: boolean;
  title: string;
  detail: string;
  currentStep: number;
  totalSteps: number;
  stepDurationMs: number;
}

export interface UseJapaneseReaderOptions {
  bookId: string;
  bookSource: ReaderBookSource;
  backend: JapaneseReaderBackend;
  settings: JapaneseReaderSettings;
  settingsActions: JapaneseReaderSettingsActions;
  isDark: boolean;
  initialLookupMode?: ReaderLookupMode;
  onMissingCapabilityWarning?: (message: string) => void;
}

export interface UseJapaneseReaderResult {
  book: ReaderBookRecord | null;
  missingBook: boolean;
  html: string | null;
  fontSize: number;
  hasSourceFurigana: boolean;
  lookupMode: ReaderLookupMode;
  setLookupMode: (mode: ReaderLookupMode) => void;
  cycleLookupMode: () => void;
  readerViewRef: React.RefObject<ReaderViewRef | null>;
  readerViewProps: ReaderViewProps | null;
  loadingState: ReaderLoadingState;
  lookupResults: LookupResult[];
  lookupLoading: boolean;
  lookupError: string | null;
  /** The text the current lookup ran on, so an empty result can name it. */
  lookupQuery: string | null;
  showLookupPopup: boolean;
  closeLookupPopup: () => void;
  copyTooltip: ReaderSelectionTooltip | null;
  copied: boolean;
  handleCopy: () => void;
  clearCopyTooltip: () => void;
  showJumpSlider: boolean;
  dismissJumpSlider: () => void;
  jumpPercent: number;
  jumpToPercent: (percent: number) => Promise<void>;
  createSettingsDraft: () => JapaneseReaderSettingsDraft;
  applySettingsDraft: (draft: JapaneseReaderSettingsDraft) => void;
  patchBook: (patch: Partial<ReaderBookRecord>) => void;
  /** The readings this book has been told to use, run → reading ("" = none). */
  furiganaPins: ReadonlyMap<string, string>;
  setFuriganaPin: (surface: string, reading: string) => Promise<void>;
  clearFuriganaPin: (surface: string) => Promise<void>;
  clearAllFuriganaPins: () => Promise<void>;
  /** What a long press is asking about, while the sheet is open. */
  furiganaPinTarget: ReaderFuriganaPinTarget | null;
  closeFuriganaPinSheet: () => void;
}

/** The run a long press landed on, and what it could be read as. */
export interface ReaderFuriganaPinTarget {
  run: string;
  /** Null until the dictionaries have answered. */
  candidates: FuriganaReadingCandidate[] | null;
  /** The reading pinned for this run, or null when none is. */
  pinnedReading: string | null;
}

type ReaderSettingsDiff = {
  fontSizeChanged: boolean;
  pageAnimationsChanged: boolean;
  bookmarkHighlightsChanged: boolean;
  furiganaChanged: boolean;
  anyChanged: boolean;
};

type ReaderTransformSettingsSnapshot = {
  sourceFuriganaEnabled: boolean;
  readerCounterFurigana: boolean;
  readerNameFurigana: boolean;
  furiganaRuleLevelsKey: string;
  /** Pinned readings are part of the furigana a page shows, so a change repaints it. */
  furiganaPinsKey: string;
};

function warnOnce(key: string, message: string, onWarning?: (message: string) => void) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (onWarning) {
    onWarning(message);
    return;
  }
  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
  if (isDev) console.warn(`[japanese-reader] ${message}`);
}

function buildReaderLoadSequence({
  needsParsing,
  needsFurigana,
}: {
  needsParsing: boolean;
  needsFurigana: boolean;
}): ReaderLoadStage[] {
  const stages: ReaderLoadStage[] = ["preparing"];
  if (needsParsing) stages.push("parsing");
  stages.push("generatingPages");
  if (needsFurigana) stages.push("generatingFurigana");
  return stages;
}

function bookHasSourceFurigana(rawContent: string): boolean {
  return /<ruby[\s>]/.test(rawContent) || hasAozoraMarkup(rawContent);
}

/**
 * Whether the page will carry ruby at all.
 *
 * This decides the line height, the `furigana-active` class and how many
 * characters fit on a page, so a single pinned reading has to count: a page
 * laid out as if it had no ruby clips the one it does have.
 */
function hasFuriganaActive(
  sourceDefault: boolean,
  showNames: boolean,
  showCounters: boolean,
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  bookHasSource: boolean,
  hasPins = false,
): boolean {
  if (hasPins) return true;
  if (bookHasSource && sourceDefault) return true;
  if (showNames || showCounters) return true;
  return Object.values(ruleLevels).some((levels) => Object.values(levels).some(Boolean));
}

function hasInjectedFuriganaActive(
  showNames: boolean,
  showCounters: boolean,
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  hasPins = false,
): boolean {
  if (hasPins) return true;
  if (showNames || showCounters) return true;
  return Object.values(ruleLevels).some((levels) => Object.values(levels).some(Boolean));
}

async function buildInjectedFuriganaKanjiSet(
  dictDb: NonNullable<JapaneseReaderBackend["dictDb"]>,
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  showNames: boolean,
  showCounters: boolean,
): Promise<FuriganaKanjiSet | null> {
  const hasRuleBasedFurigana = Object.values(ruleLevels).some((levels) =>
    Object.values(levels).some(Boolean),
  );
  if (hasRuleBasedFurigana) {
    return buildFuriganaKanjiSet(dictDb, ruleLevels.matchAnyKanji);
  }
  if (showNames || showCounters) {
    return { all: true, chars: new Set() };
  }
  return null;
}

function getReaderThemePayload(isDark: boolean) {
  return {
    bg: isDark ? "#18181b" : "#fafaf9",
    fg: isDark ? "#fafafa" : "#18181b",
    rubyColor: isDark ? "#a1a1aa" : "#71717a",
    highlightBg: isDark ? "#2e2e5f" : "#d5d5eb",
    bookmarkBg: "rgba(180, 170, 98, 0.28)",
  };
}

function stripRubyTags(html: string): string {
  return html.replace(/<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/g, "$1");
}

/**
 * A string that changes whenever any pinned reading does.
 *
 * JSON rather than `run=reading` joined by a separator: a reading containing
 * the separator would make two different pin sets share a key, and the key is
 * what tells the reader to repaint.
 */
function furiganaPinsCacheKey(pins: ReadonlyMap<string, string>): string {
  if (pins.size === 0) return "";
  return JSON.stringify([...pins.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function ruleLevelsEqual(
  a: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  b: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
): boolean {
  const rules = Object.keys(a) as ReaderFuriganaRule[];
  for (const rule of rules) {
    const levels = Object.keys(a[rule]) as FuriganaMatchLevel[];
    for (const level of levels) {
      if (a[rule][level] !== b[rule][level]) return false;
    }
  }
  return true;
}

function cloneRuleLevels(
  levels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
): Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>> {
  return {
    matchAnyKanji: { ...levels.matchAnyKanji },
    matchWordLevel: { ...levels.matchWordLevel },
    matchIrregularReading: { ...levels.matchIrregularReading },
    matchMostlyKunyomi: { ...levels.matchMostlyKunyomi },
    matchMostlyOnyomi: { ...levels.matchMostlyOnyomi },
    matchMixedOnKun: { ...levels.matchMixedOnKun },
  };
}

function getReaderSettingsDiff(
  current: JapaneseReaderSettingsDraft,
  draft: JapaneseReaderSettingsDraft,
): ReaderSettingsDiff {
  const fontSizeChanged = current.fontSize !== draft.fontSize;
  const pageAnimationsChanged = current.pageAnimations !== draft.pageAnimations;
  const bookmarkHighlightsChanged =
    current.readerBookmarkHighlights !== draft.readerBookmarkHighlights;
  const furiganaChanged =
    current.sourceFuriganaEnabled !== draft.sourceFuriganaEnabled ||
    current.readerCounterFurigana !== draft.readerCounterFurigana ||
    current.readerNameFurigana !== draft.readerNameFurigana ||
    !ruleLevelsEqual(current.furiganaRuleLevels, draft.furiganaRuleLevels);
  return {
    fontSizeChanged,
    pageAnimationsChanged,
    bookmarkHighlightsChanged,
    furiganaChanged,
    anyChanged:
      fontSizeChanged || pageAnimationsChanged || bookmarkHighlightsChanged || furiganaChanged,
  };
}

function transformSettingsSnapshotsEqual(
  a: ReaderTransformSettingsSnapshot | null,
  b: ReaderTransformSettingsSnapshot,
): boolean {
  if (!a) return false;
  return (
    a.sourceFuriganaEnabled === b.sourceFuriganaEnabled &&
    a.readerCounterFurigana === b.readerCounterFurigana &&
    a.readerNameFurigana === b.readerNameFurigana &&
    a.furiganaRuleLevelsKey === b.furiganaRuleLevelsKey &&
    a.furiganaPinsKey === b.furiganaPinsKey
  );
}

export function useJapaneseReader({
  bookId,
  bookSource,
  backend,
  settings,
  settingsActions,
  isDark,
  initialLookupMode = "auto",
  onMissingCapabilityWarning,
}: UseJapaneseReaderOptions): UseJapaneseReaderResult {
  const { dictDb, extendedDb, bookmarks, furiganaPins } = backend;
  const {
    pageAnimations,
    sourceFuriganaEnabled,
    readerCounterFurigana,
    readerNameFurigana,
    readerBookmarkHighlights,
    furiganaRuleLevels,
  } = settings;
  const readerViewRef = useRef<ReaderViewRef>(null);
  const initialScrollFiredRef = useRef(false);
  const [book, setBook] = useState<ReaderBookRecord | null>(null);
  const [missingBook, setMissingBook] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(22);
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [showLookupPopup, setShowLookupPopup] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState<string | null>(null);
  const [copyTooltip, setCopyTooltip] = useState<ReaderSelectionTooltip | null>(null);
  const [copied, setCopied] = useState(false);
  const [lookupMode, setLookupMode] = useState<ReaderLookupMode>(initialLookupMode);
  const [showJumpSlider, setShowJumpSlider] = useState(false);
  const [hasSourceFurigana, setHasSourceFurigana] = useState(false);
  const [loadingState, setLoadingState] = useState<ReaderLoadingState>({
    runId: 0,
    visible: true,
    title: READER_LOAD_STAGE_META.preparing.title,
    detail: READER_LOAD_STAGE_META.preparing.detail,
    currentStep: 1,
    totalSteps: 1,
    stepDurationMs: READER_LOAD_STEP_DURATION_MS,
  });

  const lookupModeRef = useRef<ReaderLookupMode>(initialLookupMode);
  const readerLoadTokenRef = useRef(0);
  const readerLoadDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef<TextModel | null>(null);
  const htmlRef = useRef<string | null>(null);
  const loadedBookSignatureRef = useRef<{ bookId: string; rawContent: string } | null>(null);
  const sliceCharOffsetRef = useRef(0);
  const fwdLoadedEndRef = useRef(0);
  const documentRestoredRef = useRef(false);
  const isAozoraRef = useRef(false);
  const backPrefetchingRef = useRef(false);
  const kanjiSetRef = useRef<FuriganaKanjiSet | null>(null);
  const hasSourceFuriganaRef = useRef(false);
  const furiganaEntryCacheRef = useRef<Map<string, FuriganaEntry | null>>(new Map());
  const baseSliceHtmlCacheRef = useRef<Map<string, string>>(new Map());
  const furiganaSliceHtmlCacheRef = useRef<Map<string, string>>(new Map());
  const appliedTransformSettingsRef = useRef<ReaderTransformSettingsSnapshot | null>(null);
  const currentReaderContentHtmlRef = useRef("");
  const bookmarkHighlightRequestRef = useRef(0);
  const scrollPosRef = useRef(0);
  const pendingReadCompleteRef = useRef(false);
  const lastPersistedCharOffsetRef = useRef(0);
  const lastPersistedReadCompleteRef = useRef(false);
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightPlacementRequestRef = useRef(0);
  const pendingTapTooltipRef = useRef<{
    placementId: number;
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const pendingTapTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceFuriganaEnabledRef = useRef(sourceFuriganaEnabled);
  const readerCounterFuriganaRef = useRef(readerCounterFurigana);
  const readerNameFuriganaRef = useRef(readerNameFurigana);
  const readerBookmarkHighlightsRef = useRef(readerBookmarkHighlights);
  const furiganaRuleLevelsRef = useRef(furiganaRuleLevels);
  const pageAnimationsRef = useRef(pageAnimations);
  const isDarkRef = useRef(isDark);
  const fontSizeRef = useRef(fontSize);
  const bookmarkMembershipRef = useRef<ReaderBookmarkMembership | null>(bookmarks ?? null);
  /**
   * Why each painted surface in the current slice is painted. The matcher
   * works this out anyway and the reader used to keep only the keys; holding
   * the rest is what lets a tap name the bookmarked word inside its span.
   */
  const bookmarkProvenanceRef = useRef<Map<string, BookmarkSurfaceProvenance[]>>(new Map());
  const bookmarkPlacementsRef = useRef<BookmarkRunPlacements[]>([]);
  /** Readings this book has been told to use, keyed on the run the page spells. */
  const furiganaPinsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const [furiganaPinsKey, setFuriganaPinsKey] = useState("");
  const [furiganaPinTarget, setFuriganaPinTarget] = useState<ReaderFuriganaPinTarget | null>(null);
  /** Only the latest long press may fill the sheet. */
  const furiganaPinRequestRef = useRef(0);

  useEffect(() => {
    sourceFuriganaEnabledRef.current = sourceFuriganaEnabled;
    readerCounterFuriganaRef.current = readerCounterFurigana;
    readerNameFuriganaRef.current = readerNameFurigana;
    readerBookmarkHighlightsRef.current = readerBookmarkHighlights;
    furiganaRuleLevelsRef.current = furiganaRuleLevels;
    pageAnimationsRef.current = pageAnimations;
    isDarkRef.current = isDark;
  }, [
    furiganaRuleLevels,
    isDark,
    pageAnimations,
    readerBookmarkHighlights,
    readerCounterFurigana,
    readerNameFurigana,
    sourceFuriganaEnabled,
  ]);

  useEffect(() => {
    bookmarkMembershipRef.current = bookmarks ?? null;
  }, [bookmarks]);

  /**
   * A different book is a different set of pins, and the sheet was asking about
   * a run in the one before it. Leaving either in place writes the next choice
   * to the wrong book.
   */
  useEffect(() => {
    furiganaPinRequestRef.current++;
    setFuriganaPinTarget(null);
    furiganaPinsRef.current = new Map();
    setFuriganaPinsKey("");
  }, [bookId]);

  const clearPendingTapTooltipTimer = useCallback(() => {
    if (pendingTapTooltipTimerRef.current) {
      clearTimeout(pendingTapTooltipTimerRef.current);
      pendingTapTooltipTimerRef.current = null;
    }
  }, []);

  const clearPendingTapTooltip = useCallback(() => {
    clearPendingTapTooltipTimer();
    pendingTapTooltipRef.current = null;
  }, [clearPendingTapTooltipTimer]);

  const scheduleTapTooltipFallback = useCallback(
    (placement: { placementId: number; text: string; x: number; y: number }) => {
      clearPendingTapTooltipTimer();
      pendingTapTooltipRef.current = placement;
      // Tap lookup may expand to a larger lexical match; prefer adjusted bounds, but do not hang forever.
      pendingTapTooltipTimerRef.current = setTimeout(() => {
        pendingTapTooltipTimerRef.current = null;
        if (highlightPlacementRequestRef.current !== placement.placementId) return;
        setCopyTooltip((prev) => prev ?? { text: placement.text, x: placement.x, y: placement.y });
      }, TAP_TOOLTIP_FALLBACK_MS);
    },
    [clearPendingTapTooltipTimer],
  );

  /**
   * Offer the bookmarked words that sit inside the span a tap resolved.
   *
   * Tapping takes the longest match and highlighting marks the smallest, so
   * the two routinely name different words on the same characters: the page
   * says 励み, the tap answers the noun 励み, and the bookmark is the verb
   * 励む. Each one becomes another word in the lookup, which the popup
   * already renders as a row to choose from.
   *
   * It runs after the results are shown, so a tap never waits on it.
   */
  const appendBookmarkedWordsInSpan = useCallback(
    async (
      placementId: number,
      tapOffset: number,
      results: LookupResult[],
      run: string | null,
      runOffset: number | null,
    ) => {
      const provenance = bookmarkProvenanceRef.current;
      const top = results[0];
      if (!dictDb || provenance.size === 0 || !top) return;
      // Without the run there is nowhere to look the placement up, and a tap
      // that landed on no Japanese character has no bookmark under it anyway.
      if (run === null || runOffset === null) return;

      // The tap reports offsets in its own clipped window; the placements are
      // offsets in the run. The tapped character is the fixed point of both.
      const start = (top.matchStart ?? tapOffset) - tapOffset + runOffset;
      // The window fuses paragraphs, so a match can begin outside the run the
      // tap landed in. Nothing painted there belongs to this word.
      if (start < 0 || start + top.matchedText.length > run.length) return;
      const contained = bookmarksInsideSpan(
        run,
        start,
        start + top.matchedText.length,
        provenance,
        bookmarkPlacementsRef.current,
      );
      if (contained.length === 0) return;

      const alreadyShown = new Set(results.flatMap((result) => result.entries.map((e) => e.id)));
      const extra: LookupResult[] = [];
      for (const bookmark of contained) {
        const wanted = bookmark.entryIds.filter((id) => !alreadyShown.has(id));
        if (wanted.length === 0) continue;
        const entries = await lookupEntriesByIds(dictDb, wanted);
        if (entries.length === 0) continue;
        for (const entry of entries) alreadyShown.add(entry.id);
        // Labelled with the dictionary form, not the page's spelling: 励む is
        // the word asked for, and two pills both reading 励み say nothing.
        extra.push({
          matchedText: bookmark.word,
          entries,
          deinflectReasons: bookmark.reasons,
          lookupKind: "word",
        });
      }
      if (extra.length === 0) return;
      if (highlightPlacementRequestRef.current !== placementId) return;
      setLookupResults((prev) => [...prev, ...extra]);
    },
    [dictDb],
  );

  useEffect(() => {
    lookupModeRef.current = lookupMode;
  }, [lookupMode]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    htmlRef.current = html;
  }, [html]);

  useEffect(() => {
    if (readerBookmarkHighlights && !bookmarks) {
      warnOnce(
        "missing-bookmarks",
        "Bookmark highlighting requested, but no bookmark membership was provided. Disabling bookmark highlights.",
        onMissingCapabilityWarning,
      );
    }
    if (readerNameFurigana && !extendedDb) {
      warnOnce(
        "missing-names",
        "Name furigana requested, but no extended dictionary backend was provided. Name furigana will be disabled.",
        onMissingCapabilityWarning,
      );
    }
    if (readerCounterFurigana && !extendedDb) {
      warnOnce(
        "missing-counters",
        "Counter furigana requested, but no extended dictionary backend was provided. Counter furigana will be disabled.",
        onMissingCapabilityWarning,
      );
    }
  }, [
    bookmarks,
    extendedDb,
    onMissingCapabilityWarning,
    readerBookmarkHighlights,
    readerCounterFurigana,
    readerNameFurigana,
  ]);

  const getRuleLevelsCacheKey = useCallback(
    (ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>) =>
      JSON.stringify(ruleLevels),
    [],
  );

  const getCurrentTransformSettingsSnapshot = useCallback(
    (): ReaderTransformSettingsSnapshot => ({
      sourceFuriganaEnabled,
      readerCounterFurigana,
      readerNameFurigana,
      furiganaRuleLevelsKey: getRuleLevelsCacheKey(furiganaRuleLevels),
      furiganaPinsKey,
    }),
    [
      furiganaPinsKey,
      furiganaRuleLevels,
      getRuleLevelsCacheKey,
      readerCounterFurigana,
      readerNameFurigana,
      sourceFuriganaEnabled,
    ],
  );

  const setCachedHtml = useCallback((cache: Map<string, string>, key: string, nextHtml: string) => {
    cache.delete(key);
    cache.set(key, nextHtml);
    while (cache.size > SLICE_RENDER_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey == null) break;
      cache.delete(oldestKey);
    }
  }, []);

  const clearBaseAndTransformCaches = useCallback(() => {
    baseSliceHtmlCacheRef.current.clear();
    furiganaSliceHtmlCacheRef.current.clear();
    furiganaEntryCacheRef.current.clear();
  }, []);

  const clearFuriganaCaches = useCallback(() => {
    furiganaSliceHtmlCacheRef.current.clear();
    furiganaEntryCacheRef.current.clear();
  }, []);

  const beginReaderLoad = useCallback((stages: ReaderLoadStage[]) => {
    if (readerLoadDismissTimerRef.current) {
      clearTimeout(readerLoadDismissTimerRef.current);
      readerLoadDismissTimerRef.current = null;
    }
    const token = ++readerLoadTokenRef.current;
    const firstStage = stages[0] ?? "preparing";
    const meta = READER_LOAD_STAGE_META[firstStage];
    setLoadingState({
      runId: token,
      visible: true,
      title: meta.title,
      detail: meta.detail,
      currentStep: 1,
      totalSteps: stages.length,
      stepDurationMs: READER_LOAD_STEP_DURATION_MS,
    });
    return { token, stages };
  }, []);

  const updateReaderLoadStage = useCallback(
    (token: number, stages: ReaderLoadStage[], stage: ReaderLoadStage) => {
      if (readerLoadTokenRef.current !== token) return;
      const stageIndex = stages.indexOf(stage);
      if (stageIndex < 0) return;
      const meta = READER_LOAD_STAGE_META[stage];
      const nextStep = stageIndex + 1;
      setLoadingState((prev) => ({
        ...prev,
        visible: true,
        title: meta.title,
        detail: meta.detail,
        currentStep: Math.max(prev.currentStep, nextStep),
        totalSteps: stages.length,
        stepDurationMs: READER_LOAD_STEP_DURATION_MS,
      }));
    },
    [],
  );

  const finishReaderLoad = useCallback((token: number, stages: ReaderLoadStage[]) => {
    if (readerLoadTokenRef.current !== token) return;
    setLoadingState((prev) => ({
      ...prev,
      runId: token,
      visible: true,
      currentStep: stages.length,
      totalSteps: stages.length,
      stepDurationMs: READER_LOAD_STEP_DURATION_MS,
    }));
    if (readerLoadDismissTimerRef.current) clearTimeout(readerLoadDismissTimerRef.current);
    readerLoadDismissTimerRef.current = setTimeout(() => {
      if (readerLoadTokenRef.current !== token) return;
      setLoadingState((prev) => ({ ...prev, visible: false }));
      readerLoadDismissTimerRef.current = null;
    }, READER_LOAD_DISMISS_DELAY_MS);
  }, []);

  const syncBookmarkHighlights = useCallback(
    async (contentHtml = currentReaderContentHtmlRef.current) => {
      const token = ++bookmarkHighlightRequestRef.current;
      // Dropped first: between a slice swapping and the matcher returning, a
      // tap would otherwise be answered from the slice that just left.
      bookmarkProvenanceRef.current = new Map();
      bookmarkPlacementsRef.current = [];
      const enabled = readerBookmarkHighlightsRef.current;
      const membership = bookmarkMembershipRef.current;
      const version = enabled && membership ? membership.version : "";

      if (!enabled || !dictDb || !membership || !contentHtml) {
        readerViewRef.current?.postMessage(
          JSON.stringify({ type: "setBookmarkHighlights", version, runs: [] }),
        );
        return;
      }

      const { provenance, placements } = await matchBookmarksInHtml(
        dictDb,
        contentHtml,
        membership,
      );
      if (bookmarkHighlightRequestRef.current !== token) return;
      bookmarkProvenanceRef.current = provenance;
      bookmarkPlacementsRef.current = placements;
      readerViewRef.current?.postMessage(
        JSON.stringify({ type: "setBookmarkHighlights", version, runs: placements }),
      );
    },
    [dictDb],
  );

  const renderPreformattedReaderContent = useCallback(
    async ({
      rawContent,
      sourceDefault,
      showNames,
      showCounters,
      ruleLevels,
    }: {
      rawContent: string;
      sourceDefault: boolean;
      showNames: boolean;
      showCounters: boolean;
      ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>;
    }) => {
      const hasFuri = hasFuriganaActive(sourceDefault, showNames, showCounters, ruleLevels, true);
      const stripped = hasFuri ? rawContent : stripRubyTags(rawContent);
      // A book that ships its own ruby never reaches applyFuriganaToHtml, so a
      // pin on one of its words has to be applied to that ruby directly.
      const content = applyFuriganaPinsToSourceRuby(stripped, furiganaPinsRef.current);
      return { content, hasFuri: hasFuri || furiganaPinsRef.current.size > 0 };
    },
    [],
  );

  const getBaseSliceHtml = useCallback(
    ({
      sliceText,
      startChar,
      charCount,
      isAozora,
    }: {
      sliceText: string;
      startChar: number;
      charCount: number;
      isAozora: boolean;
    }) => {
      const cacheKey = [isAozora ? "a" : "p", startChar, charCount].join(":");
      const cachedHtml = baseSliceHtmlCacheRef.current.get(cacheKey);
      if (cachedHtml != null) {
        setCachedHtml(baseSliceHtmlCacheRef.current, cacheKey, cachedHtml);
        return { cacheKey, html: cachedHtml };
      }

      const nextHtml = isAozora
        ? parseAozoraToHtml(sliceText, { strip: false })
        : plainTextToHtml(sliceText);
      setCachedHtml(baseSliceHtmlCacheRef.current, cacheKey, nextHtml);
      return { cacheKey, html: nextHtml };
    },
    [setCachedHtml],
  );

  const getFuriganaSliceHtml = useCallback(
    async ({
      baseHtml,
      baseCacheKey,
      isAozora,
      hasFuri,
      sourceDefault,
      ruleLevels,
      includeCounters,
      includeNames,
      onStage,
    }: {
      baseHtml: string;
      baseCacheKey: string;
      isAozora: boolean;
      hasFuri: boolean;
      sourceDefault: boolean;
      ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>;
      includeCounters: boolean;
      includeNames: boolean;
      onStage?: (stage: ReaderLoadStage) => void;
    }) => {
      const cacheKey = [
        baseCacheKey,
        hasFuri ? 1 : 0,
        sourceDefault ? 1 : 0,
        includeCounters ? 1 : 0,
        includeNames ? 1 : 0,
        getRuleLevelsCacheKey(ruleLevels),
        // Without this a pinned page keeps serving the reading it had.
        furiganaPinsKey,
      ].join(":");
      const cachedHtml = furiganaSliceHtmlCacheRef.current.get(cacheKey);
      if (cachedHtml != null) {
        setCachedHtml(furiganaSliceHtmlCacheRef.current, cacheKey, cachedHtml);
        return { cacheKey, html: cachedHtml };
      }

      let sliceHtml = isAozora && !sourceDefault ? stripRubyTags(baseHtml) : baseHtml;
      const pins = furiganaPinsRef.current;
      // Aozora's own ruby is generated before this runs, so a pin on one of
      // its words is applied to the ruby rather than to the text under it.
      if (pins.size > 0) sliceHtml = applyFuriganaPinsToSourceRuby(sliceHtml, pins);
      if (kanjiSetRef.current && dictDb) {
        onStage?.("generatingFurigana");
        const surfaces = extractSurfacesFromHtml(sliceHtml, kanjiSetRef.current);
        // A slice with a pin but nothing extractable — a page of kana around
        // one pinned run — still has to be painted.
        if (surfaces.length > 0 || pins.size > 0) {
          const cache = furiganaEntryCacheRef.current;
          const resolverCacheKey = `${includeNames ? 1 : 0}:${includeCounters ? 1 : 0}`;
          const missing = surfaces.filter(
            (surface) => !cache.has(`${resolverCacheKey}:${surface}`),
          );
          if (missing.length > 0) {
            const fetched = await resolveFuriganaBatch(missing, dictDb, extendedDb, {
              includeNames,
              includeCounters,
            });
            for (const surface of missing) {
              cache.set(`${resolverCacheKey}:${surface}`, fetched[surface] ?? null);
            }
          }
          const readings: Record<string, FuriganaEntry> = {};
          for (const surface of surfaces) {
            const cached = cache.get(`${resolverCacheKey}:${surface}`);
            if (cached) readings[surface] = cached;
          }
          const fMap = new Map<string, FuriganaEntry>(
            Object.entries(readings) as [string, FuriganaEntry][],
          );
          sliceHtml = applyFuriganaToHtml(sliceHtml, fMap, kanjiSetRef.current, {
            sourceDefault,
            showCounters: includeCounters,
            showNames: includeNames,
            ruleLevels,
            pins,
          });
        }
        sliceHtml = injectRubySpacers(sliceHtml);
      } else if (pins.size > 0) {
        // No dictionary furigana is active at all, but a pin is still a
        // reading the user asked for.
        sliceHtml = applyFuriganaToHtml(
          !hasFuri && isAozora ? stripRubyTags(sliceHtml) : sliceHtml,
          new Map(),
          { all: true, chars: new Set() },
          {
            sourceDefault,
            showCounters: includeCounters,
            showNames: includeNames,
            ruleLevels,
            pins,
          },
        );
        sliceHtml = injectRubySpacers(sliceHtml);
      } else if (!hasFuri && isAozora) {
        sliceHtml = stripRubyTags(sliceHtml);
      }

      setCachedHtml(furiganaSliceHtmlCacheRef.current, cacheKey, sliceHtml);
      return { cacheKey, html: sliceHtml };
    },
    [dictDb, extendedDb, furiganaPinsKey, getRuleLevelsCacheKey, setCachedHtml],
  );

  const renderSliceHtml = useCallback(
    async ({
      sliceText,
      startChar,
      charCount,
      isAozora,
      hasFuri,
      sourceDefault,
      ruleLevels,
      includeCounters,
      includeNames,
      onStage,
    }: {
      sliceText: string;
      startChar: number;
      charCount: number;
      isAozora: boolean;
      hasFuri: boolean;
      sourceDefault: boolean;
      ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>;
      includeCounters: boolean;
      includeNames: boolean;
      onStage?: (stage: ReaderLoadStage) => void;
    }) => {
      const baseSlice = getBaseSliceHtml({ sliceText, startChar, charCount, isAozora });
      const furiganaSlice = await getFuriganaSliceHtml({
        baseHtml: baseSlice.html,
        baseCacheKey: baseSlice.cacheKey,
        isAozora,
        hasFuri,
        sourceDefault,
        ruleLevels,
        includeCounters,
        includeNames,
        onStage,
      });
      return furiganaSlice.html;
    },
    [getBaseSliceHtml, getFuriganaSliceHtml],
  );

  /**
   * Write a pin and repaint.
   *
   * The ref is what the renderer reads and the key is what tells the
   * re-transform effect that the furigana changed; both move together or the
   * page keeps the reading it had.
   */
  const applyPinChange = useCallback(
    async (change: (pins: Map<string, string>) => void | Promise<void>) => {
      const next = new Map(furiganaPinsRef.current);
      await change(next);
      furiganaPinsRef.current = next;
      setFuriganaPinsKey(furiganaPinsCacheKey(next));
      setFuriganaPinTarget((prev) =>
        prev ? { ...prev, pinnedReading: next.get(prev.run) ?? null } : prev,
      );
    },
    [],
  );

  const setFuriganaPin = useCallback(
    async (surface: string, reading: string) => {
      if (!furiganaPins || !bookId || surface.length === 0) return;
      // Store first. A rejection here must leave the page as it was, rather
      // than painting a reading nothing remembers.
      await furiganaPins.set(bookId, surface, reading);
      await applyPinChange((pins) => {
        pins.set(surface, reading);
      });
    },
    [applyPinChange, bookId, furiganaPins],
  );

  const clearFuriganaPin = useCallback(
    async (surface: string) => {
      if (!furiganaPins || !bookId || surface.length === 0) return;
      await furiganaPins.clear(bookId, surface);
      await applyPinChange((pins) => {
        pins.delete(surface);
      });
    },
    [applyPinChange, bookId, furiganaPins],
  );

  const clearAllFuriganaPins = useCallback(async () => {
    if (!furiganaPins || !bookId) return;
    await furiganaPins.clearAll(bookId);
    await applyPinChange((pins) => {
      pins.clear();
    });
  }, [applyPinChange, bookId, furiganaPins]);

  /**
   * A long press asked what this run should read as. Open the sheet at once —
   * the gesture has to feel like it did something — and fill it when the
   * dictionaries answer.
   */
  const openFuriganaPinSheet = useCallback(
    async (run: string, currentReading: string) => {
      if (!furiganaPins || !dictDb || run.length === 0) return;
      // Claims the highlight: a tap lookup still resolving must not refine it.
      highlightPlacementRequestRef.current++;
      const requestId = ++furiganaPinRequestRef.current;
      const pinned = furiganaPinsRef.current.get(run);
      setFuriganaPinTarget({
        run,
        candidates: null,
        pinnedReading: pinned ?? null,
      });
      const candidates = await furiganaReadingCandidates(run, dictDb, extendedDb, {
        currentReading: currentReading.length > 0 ? currentReading : null,
      });
      if (requestId !== furiganaPinRequestRef.current) return;
      setFuriganaPinTarget((prev) => (prev && prev.run === run ? { ...prev, candidates } : prev));
    },
    [dictDb, extendedDb, furiganaPins],
  );

  const closeFuriganaPinSheet = useCallback(() => {
    furiganaPinRequestRef.current++;
    setFuriganaPinTarget(null);
    // The press painted the run it was asking about. Nothing else clears it.
    readerViewRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
  }, []);

  const cycleLookupMode = useCallback(() => {
    setLookupMode((prev) => {
      if (prev === "auto") return "name";
      if (prev === "name") return "word";
      return extendedDb ? "auto" : "word";
    });
  }, [extendedDb]);

  useEffect(() => {
    readerViewRef.current?.postMessage(
      JSON.stringify({ type: "setPageAnimations", enabled: pageAnimations }),
    );
  }, [pageAnimations]);

  useEffect(() => {
    readerViewRef.current?.postMessage(
      JSON.stringify({ type: "setTheme", theme: getReaderThemePayload(isDark) }),
    );
  }, [isDark]);

  const reloadAtChar = useCallback(
    async (charOffset: number, loadContext?: { token: number; stages: ReaderLoadStage[] }) => {
      const model = modelRef.current;
      if (!model) return;
      const currentFontSize = fontSizeRef.current;
      const isAozora = isAozoraRef.current;
      const bookHasSource = hasSourceFuriganaRef.current;
      const sourceDefault = sourceFuriganaEnabledRef.current;
      const showCounters = readerCounterFuriganaRef.current;
      const showNames = readerNameFuriganaRef.current;
      const ruleLevels = furiganaRuleLevelsRef.current;
      const hasFuri =
        kanjiSetRef.current != null ||
        hasFuriganaActive(
          sourceDefault,
          showNames,
          showCounters,
          ruleLevels,
          bookHasSource,
          furiganaPinsRef.current.size > 0,
        );

      const screen = Dimensions.get("window");
      const cpp = calcCharsPerPage(screen.width, screen.height, currentFontSize, hasFuri);
      const startChar = Math.max(0, charOffset - cpp * 10);
      const totalBudget = charOffset - startChar + cpp * 3;
      const slice = sliceContent(model, startChar, totalBudget);
      const targetLocalChar = charOffset - startChar;

      sliceCharOffsetRef.current = startChar;
      fwdLoadedEndRef.current = Math.min(startChar + totalBudget, model.totalChars);
      backPrefetchingRef.current = false;

      if (loadContext) {
        updateReaderLoadStage(loadContext.token, loadContext.stages, "generatingPages");
      }
      const sliceHtml = await renderSliceHtml({
        sliceText: slice.text,
        startChar,
        charCount: slice.text.length,
        isAozora,
        hasFuri,
        sourceDefault,
        ruleLevels,
        includeCounters: showCounters,
        includeNames: showNames,
        onStage: loadContext
          ? (stage) => updateReaderLoadStage(loadContext.token, loadContext.stages, stage)
          : undefined,
      });
      currentReaderContentHtmlRef.current = sliceHtml;

      readerViewRef.current?.postMessage(
        JSON.stringify({
          type: "reloadContent",
          html: sliceHtml,
          sliceCharOffset: startChar,
          targetLocalChar,
          lineHeight: hasFuri
            ? `${currentFontSize * 2}px`
            : `${Math.round(currentFontSize * 1.5)}px`,
          hasFurigana: hasFuri,
        }),
      );
      void syncBookmarkHighlights(sliceHtml);
    },
    [renderSliceHtml, syncBookmarkHighlights, updateReaderLoadStage],
  );

  const flushReadingProgress = useCallback(async () => {
    if (!bookId) return;

    const charOffset = scrollPosRef.current;
    const readComplete = pendingReadCompleteRef.current;
    if (
      charOffset === lastPersistedCharOffsetRef.current &&
      readComplete === lastPersistedReadCompleteRef.current
    ) {
      return;
    }

    await bookSource.saveProgress({
      bookId,
      charOffset,
      readComplete,
      totalChars: modelRef.current?.totalChars,
    });
    lastPersistedCharOffsetRef.current = charOffset;
    lastPersistedReadCompleteRef.current = readComplete;
  }, [bookId, bookSource]);

  const scheduleReadingProgressFlush = useCallback(
    (immediate = false) => {
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current);
        progressFlushTimerRef.current = null;
      }
      if (immediate) {
        void flushReadingProgress();
        return;
      }
      progressFlushTimerRef.current = setTimeout(() => {
        progressFlushTimerRef.current = null;
        void flushReadingProgress();
      }, READ_PROGRESS_FLUSH_MS);
    },
    [flushReadingProgress],
  );

  useEffect(() => {
    return () => {
      if (readerLoadDismissTimerRef.current) clearTimeout(readerLoadDismissTimerRef.current);
      if (progressFlushTimerRef.current) clearTimeout(progressFlushTimerRef.current);
      if (pendingTapTooltipTimerRef.current) clearTimeout(pendingTapTooltipTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      let load: { token: number; stages: ReaderLoadStage[] } | null = null;
      try {
        const nextBook = await bookSource.loadBook(bookId);
        if (!nextBook || !nextBook.rawContent) {
          setMissingBook(true);
          setBook(null);
          setHtml(null);
          htmlRef.current = null;
          loadedBookSignatureRef.current = null;
          return;
        }

        const previousSignature = loadedBookSignatureRef.current;
        if (
          htmlRef.current !== null &&
          previousSignature?.bookId === bookId &&
          previousSignature.rawContent === nextBook.rawContent
        ) {
          setMissingBook(false);
          setBook(nextBook);
          fontSizeRef.current = nextBook.fontSize;
          setFontSize(nextBook.fontSize);
          lastPersistedCharOffsetRef.current = nextBook.charOffset;
          lastPersistedReadCompleteRef.current = !!nextBook.readComplete;
          pendingReadCompleteRef.current = !!nextBook.readComplete;
          return;
        }

        setMissingBook(false);
        setBook(nextBook);
        fontSizeRef.current = nextBook.fontSize;
        setFontSize(nextBook.fontSize);
        lastPersistedCharOffsetRef.current = nextBook.charOffset;
        lastPersistedReadCompleteRef.current = !!nextBook.readComplete;
        pendingReadCompleteRef.current = !!nextBook.readComplete;

        // Before the first render: a page painted without them would have to
        // be thrown away and painted again.
        const pins = (await furiganaPins?.list(bookId)) ?? new Map<string, string>();
        furiganaPinsRef.current = pins;
        const pinsKey = furiganaPinsCacheKey(pins);
        setFuriganaPinsKey(pinsKey);

        const rawContent = nextBook.rawContent;
        const hasSource = bookHasSourceFurigana(rawContent);
        hasSourceFuriganaRef.current = hasSource;
        setHasSourceFurigana(hasSource);
        clearBaseAndTransformCaches();
        const sourceDefault = sourceFuriganaEnabledRef.current;
        const showNames = readerNameFuriganaRef.current;
        const showCounters = readerCounterFuriganaRef.current;
        const ruleLevels = furiganaRuleLevelsRef.current;
        const currentPageAnimations = pageAnimationsRef.current;
        const currentIsDark = isDarkRef.current;
        const transformSnapshot: ReaderTransformSettingsSnapshot = {
          sourceFuriganaEnabled: sourceDefault,
          readerCounterFurigana: showCounters,
          readerNameFurigana: showNames,
          furiganaRuleLevelsKey: getRuleLevelsCacheKey(ruleLevels),
          furiganaPinsKey: pinsKey,
        };

        const hasRubyTags = /<ruby[>\s]/.test(rawContent);
        load = beginReaderLoad(
          buildReaderLoadSequence({
            needsParsing: !hasRubyTags,
            needsFurigana:
              !hasRubyTags &&
              hasInjectedFuriganaActive(showNames, showCounters, ruleLevels, pins.size > 0),
          }),
        );
        const activeLoad = load;

        if (hasRubyTags) {
          modelRef.current = null;
          updateReaderLoadStage(activeLoad.token, activeLoad.stages, "generatingPages");
          const { content, hasFuri } = await renderPreformattedReaderContent({
            rawContent,
            sourceDefault,
            showNames,
            showCounters,
            ruleLevels,
          });
          currentReaderContentHtmlRef.current = content;
          const readerHtml = generateReaderHtml(content, {
            fontSize: nextBook.fontSize,
            isDark: currentIsDark,
            scrollPosition: nextBook.scrollPosition,
            hasFurigana: hasFuri,
            pageAnimations: currentPageAnimations,
          });
          appliedTransformSettingsRef.current = transformSnapshot;
          loadedBookSignatureRef.current = { bookId, rawContent };
          setHtml(readerHtml);
          htmlRef.current = readerHtml;
        } else {
          updateReaderLoadStage(activeLoad.token, activeLoad.stages, "parsing");
          const isAozora = hasAozoraMarkup(rawContent);
          const stripped = isAozora ? stripAozoraBoilerplate(rawContent) : rawContent;
          const format: BookFormat = isAozora ? "aozora" : "plain";
          const model = parseBookContent(stripped, format);

          const screen = Dimensions.get("window");
          const hasFuri = hasFuriganaActive(
            sourceDefault,
            showNames,
            showCounters,
            ruleLevels,
            isAozora,
            pins.size > 0,
          );
          const cpp = calcCharsPerPage(screen.width, screen.height, nextBook.fontSize, hasFuri);

          let charOffset = nextBook.charOffset;
          if (charOffset === 0 && nextBook.scrollPosition > 0) {
            charOffset = Math.round(nextBook.scrollPosition * model.totalChars);
          }

          const startChar = Math.max(0, charOffset - cpp * 10);
          const totalBudget = charOffset - startChar + cpp * 3;
          const slice = sliceContent(model, startChar, totalBudget);
          const targetLocalChar = charOffset - startChar;

          modelRef.current = model;
          sliceCharOffsetRef.current = startChar;
          fwdLoadedEndRef.current = Math.min(startChar + totalBudget, model.totalChars);
          isAozoraRef.current = isAozora;

          if (!dictDb && hasInjectedFuriganaActive(showNames, showCounters, ruleLevels, false)) {
            warnOnce(
              "missing-dictdb-furigana",
              "Injected furigana requested, but no dictionary backend was provided. Reader will render without injected furigana.",
              onMissingCapabilityWarning,
            );
          }

          const injectedFuriganaSet = dictDb
            ? await buildInjectedFuriganaKanjiSet(dictDb, ruleLevels, showNames, showCounters)
            : null;
          kanjiSetRef.current = injectedFuriganaSet;
          furiganaEntryCacheRef.current.clear();
          updateReaderLoadStage(activeLoad.token, activeLoad.stages, "generatingPages");
          const sliceHtml = await renderSliceHtml({
            sliceText: slice.text,
            startChar,
            charCount: slice.text.length,
            isAozora,
            hasFuri,
            sourceDefault,
            ruleLevels,
            includeCounters: showCounters,
            includeNames: showNames,
            onStage: (stage) => updateReaderLoadStage(activeLoad.token, activeLoad.stages, stage),
          });
          currentReaderContentHtmlRef.current = sliceHtml;

          const readerHtml = generateReaderHtml(sliceHtml, {
            fontSize: nextBook.fontSize,
            isDark: currentIsDark,
            targetLocalChar,
            sliceCharOffset: startChar,
            totalChars: model.totalChars,
            hasFurigana: hasFuri,
            pageAnimations: currentPageAnimations,
          });
          if (nextBook.totalChars === 0) {
            await bookSource.saveProgress({
              bookId,
              charOffset,
              totalChars: model.totalChars,
              readComplete: !!nextBook.readComplete,
            });
          }
          appliedTransformSettingsRef.current = transformSnapshot;
          loadedBookSignatureRef.current = { bookId, rawContent };
          setHtml(readerHtml);
          htmlRef.current = readerHtml;
        }

        await bookSource.markOpened?.(bookId);
      } finally {
        if (load) finishReaderLoad(load.token, load.stages);
      }
    })();
  }, [
    beginReaderLoad,
    bookId,
    bookSource,
    clearBaseAndTransformCaches,
    dictDb,
    finishReaderLoad,
    furiganaPins,
    getRuleLevelsCacheKey,
    onMissingCapabilityWarning,
    renderPreformattedReaderContent,
    renderSliceHtml,
    updateReaderLoadStage,
  ]);

  useEffect(() => {
    if (!book || !book.rawContent || html === null) return;
    const rawContent = book.rawContent;
    const nextSnapshot = getCurrentTransformSettingsSnapshot();
    const previousSnapshot = appliedTransformSettingsRef.current;
    if (transformSettingsSnapshotsEqual(previousSnapshot, nextSnapshot)) return;

    const furiganaChanged =
      !previousSnapshot ||
      previousSnapshot.sourceFuriganaEnabled !== nextSnapshot.sourceFuriganaEnabled ||
      previousSnapshot.readerCounterFurigana !== nextSnapshot.readerCounterFurigana ||
      previousSnapshot.readerNameFurigana !== nextSnapshot.readerNameFurigana ||
      previousSnapshot.furiganaRuleLevelsKey !== nextSnapshot.furiganaRuleLevelsKey ||
      previousSnapshot.furiganaPinsKey !== nextSnapshot.furiganaPinsKey;
    (async () => {
      const hasRubyTags = /<ruby[>\s]/.test(rawContent);
      const load = beginReaderLoad(
        buildReaderLoadSequence({
          needsParsing: !hasRubyTags,
          needsFurigana: furiganaChanged,
        }),
      );
      try {
        if (hasRubyTags) {
          updateReaderLoadStage(load.token, load.stages, "generatingPages");
          const { content, hasFuri } = await renderPreformattedReaderContent({
            rawContent,
            sourceDefault: sourceFuriganaEnabled,
            showNames: readerNameFurigana,
            showCounters: readerCounterFurigana,
            ruleLevels: furiganaRuleLevels,
          });
          currentReaderContentHtmlRef.current = content;
          readerViewRef.current?.postMessage(
            JSON.stringify({
              type: "reloadContent",
              html: content,
              sliceCharOffset: 0,
              targetLocalChar: scrollPosRef.current || 0,
              lineHeight: hasFuri
                ? `${fontSizeRef.current * 2}px`
                : `${Math.round(fontSizeRef.current * 1.5)}px`,
              hasFurigana: hasFuri,
            }),
          );
          void syncBookmarkHighlights(content);
          appliedTransformSettingsRef.current = nextSnapshot;
          return;
        }

        if (!modelRef.current) return;
        if (furiganaChanged) {
          kanjiSetRef.current = dictDb
            ? await buildInjectedFuriganaKanjiSet(
                dictDb,
                furiganaRuleLevels,
                readerNameFurigana,
                readerCounterFurigana,
              )
            : null;
          clearFuriganaCaches();
        }

        const charOffset = scrollPosRef.current || 0;
        await reloadAtChar(charOffset, load);
        appliedTransformSettingsRef.current = nextSnapshot;
      } finally {
        finishReaderLoad(load.token, load.stages);
      }
    })();
  }, [
    beginReaderLoad,
    book,
    clearFuriganaCaches,
    dictDb,
    finishReaderLoad,
    getCurrentTransformSettingsSnapshot,
    html,
    reloadAtChar,
    renderPreformattedReaderContent,
    furiganaRuleLevels,
    readerCounterFurigana,
    readerNameFurigana,
    sourceFuriganaEnabled,
    syncBookmarkHighlights,
    updateReaderLoadStage,
  ]);

  useEffect(() => {
    if (html === null) return;
    void syncBookmarkHighlights();
  }, [bookmarks?.version, html, readerBookmarkHighlights, syncBookmarkHighlights]);

  useEffect(() => {
    return () => {
      if (bookId && scrollPosRef.current > 0) void flushReadingProgress();
    };
  }, [bookId, flushReadingProgress]);

  const closeLookupPopup = useCallback(() => {
    highlightPlacementRequestRef.current += 1;
    clearPendingTapTooltip();
    setShowLookupPopup(false);
    setLookupResults([]);
    setLookupLoading(false);
    setLookupError(null);
    setCopyTooltip(null);
    setCopied(false);
    readerViewRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
    readerViewRef.current?.focus();
  }, [clearPendingTapTooltip]);

  const handleMessage = useCallback(
    async (data: string) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "highlightBounds") {
          if (msg.placementId !== highlightPlacementRequestRef.current) return;
          if (typeof msg.selectionX !== "number" || typeof msg.selectionTop !== "number") return;
          const pending = pendingTapTooltipRef.current;
          const pendingText =
            pending && pending.placementId === msg.placementId ? pending.text : null;
          clearPendingTapTooltipTimer();
          setCopyTooltip((prev) => {
            const text = prev?.text ?? pendingText;
            if (!text) return prev;
            return { text, x: msg.selectionX, y: msg.selectionTop };
          });
          pendingTapTooltipRef.current = null;
          return;
        }

        if (msg.type === "tap" || msg.type === "selection") {
          const text = msg.text as string;
          if (!text || text.length === 0) return;
          const placementId = highlightPlacementRequestRef.current + 1;
          highlightPlacementRequestRef.current = placementId;
          clearPendingTapTooltip();

          const currentLookupMode = lookupModeRef.current;
          const isNameMode = currentLookupMode === "name";
          const isAutoMode = currentLookupMode === "auto";

          if (isNameMode && !extendedDb) return;
          if ((currentLookupMode === "word" || isAutoMode) && !dictDb) return;

          setLookupResults([]);
          setLookupLoading(true);
          setLookupError(null);
          setLookupQuery(text);
          setShowLookupPopup(true);
          setCopyTooltip(null);
          setCopied(false);

          if (msg.type === "selection") {
            setCopyTooltip({
              text,
              x: msg.selectionX ?? msg.startX ?? 0,
              y: msg.selectionTop ?? msg.startY ?? 0,
            });
            let found = 0;
            if (isNameMode) {
              const names = await nameLookup(text, extendedDb!);
              found = names.length;
              setLookupResults(names);
            } else if (isAutoMode) {
              const results = await autoSelectionLookup(text, dictDb!, extendedDb, {
                prefix: msg.prefix || "",
                suffix: msg.suffix || "",
              });
              found = results.length;
              setLookupResults(results);
            } else {
              await selectionLookup(
                text,
                dictDb!,
                (result) => {
                  found++;
                  setLookupResults((prev) => [...prev, result]);
                },
                { prefix: msg.prefix || "", suffix: msg.suffix || "", extendedDb },
              );
            }
            if (found === 0) {
              // "No results found" on its own says nothing about which of the
              // selection, the mode or the dictionary came up short.
              warnOnce(
                `empty-selection:${text}`,
                `selection lookup found nothing for ${JSON.stringify(text)} ` +
                  `(mode ${isNameMode ? "name" : isAutoMode ? "auto" : "word"}, ` +
                  `prefix ${JSON.stringify(msg.prefix || "")}, ` +
                  `suffix ${JSON.stringify(msg.suffix || "")})`,
              );
            }
          } else {
            const tapOffset = msg.tapOffset as number | undefined;
            const results = isNameMode
              ? tapOffset && tapOffset > 0
                ? await nameLookupWithOffset(text, tapOffset, extendedDb!)
                : await nameLookup(text, extendedDb!)
              : isAutoMode
                ? tapOffset && tapOffset > 0
                  ? await autoLookupWithOffset(text, tapOffset, dictDb!, extendedDb)
                  : await autoLookup(text, dictDb!, extendedDb)
                : tapOffset && tapOffset > 0
                  ? await smartLookupWithOffset(text, tapOffset, dictDb!, extendedDb)
                  : await smartLookup(text, dictDb!, extendedDb);

            setLookupResults(results);
            appendBookmarkedWordsInSpan(
              placementId,
              tapOffset ?? 0,
              results,
              (msg.run as string | null) ?? null,
              (msg.runOffset as number | null) ?? null,
            ).catch((err) => {
              console.error("[reader] could not offer the bookmarked words in a tap", err);
            });
            scheduleTapTooltipFallback({
              placementId,
              text: results.length > 0 ? results[0].matchedText : text,
              x: msg.x ?? 0,
              y: msg.y ?? 0,
            });

            // A long press that fired while this lookup was in flight has
            // bumped the counter and painted its own run. Refining the tap's
            // highlight now would wipe it and paint a different word under the
            // open sheet.
            if (results.length > 0 && placementId === highlightPlacementRequestRef.current) {
              const matchStart = results[0].matchStart ?? (tapOffset || 0);
              const startDelta = matchStart - (tapOffset || 0);
              readerViewRef.current?.postMessage(
                JSON.stringify({
                  type: "highlight",
                  placementId,
                  start: startDelta,
                  length: results[0].matchedText.length,
                }),
              );
            }
          }
          setLookupLoading(false);
        } else if (msg.type === "furiganaPin") {
          void openFuriganaPinSheet(
            typeof msg.run === "string" ? msg.run : "",
            typeof msg.currentReading === "string" ? msg.currentReading : "",
          );
        } else if (msg.type === "error") {
          setLookupResults([]);
          setLookupLoading(false);
          setLookupError(msg.message || "An error occurred");
          setShowLookupPopup(true);
        } else if (msg.type === "scroll") {
          scrollPosRef.current = msg.charOffset;
          const finished = isBookFinished({
            isLastPageOfWindow: !!msg.isLastPage,
            loadedEndChar: fwdLoadedEndRef.current,
            totalChars: modelRef.current?.totalChars ?? 0,
          });
          pendingReadCompleteRef.current = finished;
          const flushMode = getReaderProgressFlushMode({
            initialScrollHandled: initialScrollFiredRef.current,
            isLastPage: finished,
            lastPersistedReadComplete: lastPersistedReadCompleteRef.current,
          });
          if (flushMode === "skip") {
            initialScrollFiredRef.current = true;
          } else {
            scheduleReadingProgressFlush(flushMode === "immediate");
          }
        } else if (msg.type === "pageRendered") {
          const model = modelRef.current;
          if (!model) return;
          const globalLastChar = sliceCharOffsetRef.current + msg.lastCharIndex;
          const nextStart = globalLastChar + 1;
          if (nextStart < model.totalChars && nextStart >= fwdLoadedEndRef.current) {
            const hasFuri =
              kanjiSetRef.current != null ||
              hasFuriganaActive(
                sourceFuriganaEnabledRef.current,
                readerNameFuriganaRef.current,
                readerCounterFuriganaRef.current,
                furiganaRuleLevelsRef.current,
                hasSourceFuriganaRef.current,
                furiganaPinsRef.current.size > 0,
              );
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSizeRef.current, hasFuri);
            const nextSlice = sliceContent(model, nextStart, cpp * 3);
            const newEnd = Math.min(nextStart + cpp * 3, model.totalChars);
            const nextHtml = await renderSliceHtml({
              sliceText: nextSlice.text,
              startChar: nextStart,
              charCount: nextSlice.text.length,
              isAozora: isAozoraRef.current,
              hasFuri,
              sourceDefault: sourceFuriganaEnabledRef.current,
              ruleLevels: furiganaRuleLevelsRef.current,
              includeCounters: readerCounterFuriganaRef.current,
              includeNames: readerNameFuriganaRef.current,
            });
            fwdLoadedEndRef.current = newEnd;
            // The WebView deletes everything after this character before it
            // appends, so the matcher's copy is cut at the same place. Left
            // whole it would describe a paragraph the page no longer shows,
            // and a bookmark placement is keyed by the text of its run.
            currentReaderContentHtmlRef.current =
              truncateHtmlAtVisibleChars(
                currentReaderContentHtmlRef.current,
                msg.lastCharIndex + 1,
              ) + nextHtml;
            readerViewRef.current?.postMessage(
              JSON.stringify({
                type: "setNextContent",
                html: nextHtml,
                replaceFromChar: msg.lastCharIndex + 1,
              }),
            );
            void syncBookmarkHighlights();
          }

          const localPage = msg.localPage ?? 1;
          if (localPage <= 2 && sliceCharOffsetRef.current > 0 && !backPrefetchingRef.current) {
            backPrefetchingRef.current = true;
            const hasFuri =
              kanjiSetRef.current != null ||
              hasFuriganaActive(
                sourceFuriganaEnabledRef.current,
                readerNameFuriganaRef.current,
                readerCounterFuriganaRef.current,
                furiganaRuleLevelsRef.current,
                hasSourceFuriganaRef.current,
                furiganaPinsRef.current.size > 0,
              );
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSizeRef.current, hasFuri);
            const backStart = Math.max(0, sliceCharOffsetRef.current - cpp * 10);
            const backChars = sliceCharOffsetRef.current - backStart;
            if (backChars > 0) {
              const backSlice = sliceContent(model, backStart, backChars);
              const backHtml = await renderSliceHtml({
                sliceText: backSlice.text,
                startChar: backStart,
                charCount: backSlice.text.length,
                isAozora: isAozoraRef.current,
                hasFuri,
                sourceDefault: sourceFuriganaEnabledRef.current,
                ruleLevels: furiganaRuleLevelsRef.current,
                includeCounters: readerCounterFuriganaRef.current,
                includeNames: readerNameFuriganaRef.current,
              });
              currentReaderContentHtmlRef.current = backHtml + currentReaderContentHtmlRef.current;
              readerViewRef.current?.postMessage(
                JSON.stringify({
                  type: "setPrevContent",
                  html: backHtml,
                  charCount: backChars,
                }),
              );
              void syncBookmarkHighlights();
              sliceCharOffsetRef.current = backStart;
            } else {
              backPrefetchingRef.current = false;
            }
          }
        } else if (msg.type === "backPrefetchDone") {
          backPrefetchingRef.current = false;
        } else if (msg.type === "percentTap") {
          setShowJumpSlider(true);
        } else if (msg.type === "ready") {
          void syncBookmarkHighlights();
          // A restored document boots from the HTML baked at open time, so
          // re-seed it at the offset reached since, or the reader jumps back.
          if (documentRestoredRef.current) {
            documentRestoredRef.current = false;
            if (scrollPosRef.current > 0) void reloadAtChar(scrollPosRef.current);
          }
        }
      } catch {}
    },
    [
      appendBookmarkedWordsInSpan,
      clearPendingTapTooltip,
      clearPendingTapTooltipTimer,
      dictDb,
      extendedDb,
      openFuriganaPinSheet,
      reloadAtChar,
      renderSliceHtml,
      scheduleReadingProgressFlush,
      scheduleTapTooltipFallback,
      syncBookmarkHighlights,
    ],
  );

  // The webview document was destroyed and remounted; the next "ready" belongs
  // to a fresh document that still carries the open-time position.
  const handleDocumentTerminated = useCallback(() => {
    documentRestoredRef.current = true;
  }, []);

  const handleCopy = useCallback(() => {
    if (!copyTooltip) return;
    readerViewRef.current?.postMessage(
      JSON.stringify({ type: "copyToClipboard", text: copyTooltip.text }),
    );
    setCopied(true);
    setTimeout(() => {
      setCopyTooltip(null);
      setCopied(false);
    }, 800);
  }, [copyTooltip]);

  const applyFontSizeChange = useCallback(
    (newSize: number) => {
      const rounded = Math.round(newSize);
      fontSizeRef.current = rounded;
      setFontSize(rounded);
      const hasFuri =
        kanjiSetRef.current != null ||
        hasFuriganaActive(
          sourceFuriganaEnabledRef.current,
          readerNameFuriganaRef.current,
          readerCounterFuriganaRef.current,
          furiganaRuleLevelsRef.current,
          hasSourceFuriganaRef.current,
          furiganaPinsRef.current.size > 0,
        );
      const lineHeight = hasFuri ? `${rounded * 2}px` : `${Math.round(rounded * 1.5)}px`;
      readerViewRef.current?.postMessage(
        JSON.stringify({ type: "setFontSize", size: rounded, lineHeight }),
      );
      setBook((prev) => (prev ? { ...prev, fontSize: rounded } : prev));
      void bookSource.savePreferences?.({ bookId, fontSize: rounded });
    },
    [bookId, bookSource],
  );

  const createSettingsDraft = useCallback(
    (): JapaneseReaderSettingsDraft => ({
      fontSize: fontSizeRef.current,
      pageAnimations,
      sourceFuriganaEnabled,
      readerCounterFurigana,
      readerNameFurigana,
      readerBookmarkHighlights,
      furiganaRuleLevels: cloneRuleLevels(furiganaRuleLevels),
    }),
    [
      furiganaRuleLevels,
      pageAnimations,
      readerBookmarkHighlights,
      readerCounterFurigana,
      readerNameFurigana,
      sourceFuriganaEnabled,
    ],
  );

  const applySettingsDraft = useCallback(
    (draft: JapaneseReaderSettingsDraft) => {
      const current = createSettingsDraft();
      const diff = getReaderSettingsDiff(current, draft);
      if (!diff.anyChanged) return;

      if (diff.fontSizeChanged) {
        applyFontSizeChange(draft.fontSize);
      }

      startTransition(() => {
        if (diff.pageAnimationsChanged) {
          settingsActions.setPageAnimations(draft.pageAnimations);
        }
        if (diff.bookmarkHighlightsChanged) {
          settingsActions.setReaderBookmarkHighlights(draft.readerBookmarkHighlights);
        }
        if (diff.furiganaChanged) {
          settingsActions.setSourceFuriganaEnabled(draft.sourceFuriganaEnabled);
          settingsActions.setReaderCounterFurigana(draft.readerCounterFurigana);
          settingsActions.setReaderNameFurigana(draft.readerNameFurigana);
          settingsActions.setFuriganaRuleLevels(cloneRuleLevels(draft.furiganaRuleLevels));
        }
      });
    },
    [applyFontSizeChange, createSettingsDraft, settingsActions],
  );

  const jumpPercent = useMemo(() => {
    if (!modelRef.current || modelRef.current.totalChars <= 0) return 0;
    return Math.round((scrollPosRef.current / modelRef.current.totalChars) * 100);
  }, [showJumpSlider, loadingState.runId]);

  const jumpToPercent = useCallback(
    async (percent: number) => {
      setShowJumpSlider(false);
      const model = modelRef.current;
      if (!model) return;
      const charOffset = Math.round((percent / 100) * model.totalChars);
      await reloadAtChar(charOffset);
    },
    [reloadAtChar],
  );

  return {
    book,
    missingBook,
    html,
    fontSize,
    hasSourceFurigana,
    lookupMode,
    setLookupMode,
    cycleLookupMode,
    readerViewRef,
    readerViewProps: html
      ? { html, onMessage: handleMessage, onContentProcessTerminated: handleDocumentTerminated }
      : null,
    loadingState,
    lookupResults,
    lookupLoading,
    lookupError,
    lookupQuery,
    showLookupPopup,
    closeLookupPopup,
    copyTooltip,
    copied,
    handleCopy,
    clearCopyTooltip: () => {
      setCopyTooltip(null);
      setCopied(false);
    },
    showJumpSlider,
    dismissJumpSlider: () => setShowJumpSlider(false),
    jumpPercent,
    jumpToPercent,
    createSettingsDraft,
    applySettingsDraft,
    patchBook: (patch) => setBook((prev) => (prev ? { ...prev, ...patch } : prev)),
    furiganaPins: furiganaPinsRef.current,
    setFuriganaPin,
    clearFuriganaPin,
    clearAllFuriganaPins,
    furiganaPinTarget,
    closeFuriganaPinSheet,
  };
}
