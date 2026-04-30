import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions } from "react-native";
import {
  calcCharsPerPage,
  type BookFormat,
  generateReaderHtml,
  getReaderProgressFlushMode,
  hasAozoraMarkup,
  parseAozoraToHtml,
  parseBookContent,
  plainTextToHtml,
  sliceContent,
  stripAozoraBoilerplate,
  type TextModel,
} from "@jiten/japanese-reader-core";
import type { JapaneseReaderBackend, ReaderBookSource } from "./backend";
import { resolveBookmarkedWordSurfacesInHtml } from "./bookmarks";
import {
  applyFuriganaToHtml,
  buildFuriganaKanjiSet,
  extractSurfacesFromHtml,
  injectRubySpacers,
  resolveFuriganaBatch,
  type FuriganaEntry,
  type FuriganaKanjiSet,
} from "./furigana";
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

function hasFuriganaActive(
  sourceDefault: boolean,
  showNames: boolean,
  showCounters: boolean,
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
  bookHasSource: boolean,
): boolean {
  if (bookHasSource && sourceDefault) return true;
  if (showNames || showCounters) return true;
  return Object.values(ruleLevels).some((levels) => Object.values(levels).some(Boolean));
}

function hasInjectedFuriganaActive(
  showNames: boolean,
  showCounters: boolean,
  ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>,
): boolean {
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
    a.furiganaRuleLevelsKey === b.furiganaRuleLevelsKey
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
  const { dictDb, extendedDb, bookmarks } = backend;
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
  const sliceCharOffsetRef = useRef(0);
  const fwdLoadedEndRef = useRef(0);
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
  const pendingTapPos = useRef<{ x: number; y: number } | null>(null);
  const sourceFuriganaEnabledRef = useRef(settings.sourceFuriganaEnabled);
  const readerCounterFuriganaRef = useRef(settings.readerCounterFurigana);
  const readerNameFuriganaRef = useRef(settings.readerNameFurigana);
  const readerBookmarkHighlightsRef = useRef(settings.readerBookmarkHighlights);
  const furiganaRuleLevelsRef = useRef(settings.furiganaRuleLevels);
  const fontSizeRef = useRef(fontSize);
  const bookmarkMembershipRef = useRef<ReaderBookmarkMembership | null>(bookmarks ?? null);

  useEffect(() => {
    sourceFuriganaEnabledRef.current = settings.sourceFuriganaEnabled;
    readerCounterFuriganaRef.current = settings.readerCounterFurigana;
    readerNameFuriganaRef.current = settings.readerNameFurigana;
    readerBookmarkHighlightsRef.current = settings.readerBookmarkHighlights;
    furiganaRuleLevelsRef.current = settings.furiganaRuleLevels;
  }, [settings]);

  useEffect(() => {
    bookmarkMembershipRef.current = bookmarks ?? null;
  }, [bookmarks]);

  useEffect(() => {
    lookupModeRef.current = lookupMode;
  }, [lookupMode]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    if (settings.readerBookmarkHighlights && !bookmarks) {
      warnOnce(
        "missing-bookmarks",
        "Bookmark highlighting requested, but no bookmark membership was provided. Disabling bookmark highlights.",
        onMissingCapabilityWarning,
      );
    }
    if (settings.readerNameFurigana && !extendedDb) {
      warnOnce(
        "missing-names",
        "Name furigana requested, but no extended dictionary backend was provided. Name furigana will be disabled.",
        onMissingCapabilityWarning,
      );
    }
    if (settings.readerCounterFurigana && !extendedDb) {
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
    settings.readerBookmarkHighlights,
    settings.readerCounterFurigana,
    settings.readerNameFurigana,
  ]);

  const getRuleLevelsCacheKey = useCallback(
    (ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>) =>
      JSON.stringify(ruleLevels),
    [],
  );

  const getCurrentTransformSettingsSnapshot = useCallback(
    (): ReaderTransformSettingsSnapshot => ({
      sourceFuriganaEnabled: settings.sourceFuriganaEnabled,
      readerCounterFurigana: settings.readerCounterFurigana,
      readerNameFurigana: settings.readerNameFurigana,
      furiganaRuleLevelsKey: getRuleLevelsCacheKey(settings.furiganaRuleLevels),
    }),
    [getRuleLevelsCacheKey, settings],
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
      const enabled = readerBookmarkHighlightsRef.current;
      const membership = bookmarkMembershipRef.current;
      const version = enabled && membership ? membership.version : "";

      if (!enabled || !dictDb || !membership || !contentHtml) {
        readerViewRef.current?.postMessage(
          JSON.stringify({ type: "setBookmarkHighlights", version, surfaces: [] }),
        );
        return;
      }

      const surfaces = await resolveBookmarkedWordSurfacesInHtml(dictDb, contentHtml, membership);
      if (bookmarkHighlightRequestRef.current !== token) return;
      readerViewRef.current?.postMessage(
        JSON.stringify({
          type: "setBookmarkHighlights",
          version,
          surfaces: [...surfaces],
        }),
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
      const content = hasFuri ? rawContent : stripRubyTags(rawContent);
      return { content, hasFuri };
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
      ].join(":");
      const cachedHtml = furiganaSliceHtmlCacheRef.current.get(cacheKey);
      if (cachedHtml != null) {
        setCachedHtml(furiganaSliceHtmlCacheRef.current, cacheKey, cachedHtml);
        return { cacheKey, html: cachedHtml };
      }

      let sliceHtml = isAozora && !sourceDefault ? stripRubyTags(baseHtml) : baseHtml;
      if (kanjiSetRef.current && dictDb) {
        onStage?.("generatingFurigana");
        const surfaces = extractSurfacesFromHtml(sliceHtml, kanjiSetRef.current);
        if (surfaces.length > 0) {
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
          });
        }
        sliceHtml = injectRubySpacers(sliceHtml);
      } else if (!hasFuri && isAozora) {
        sliceHtml = stripRubyTags(sliceHtml);
      }

      setCachedHtml(furiganaSliceHtmlCacheRef.current, cacheKey, sliceHtml);
      return { cacheKey, html: sliceHtml };
    },
    [dictDb, extendedDb, getRuleLevelsCacheKey, setCachedHtml],
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

  const cycleLookupMode = useCallback(() => {
    setLookupMode((prev) => {
      if (prev === "auto") return "name";
      if (prev === "name") return "word";
      return extendedDb ? "auto" : "word";
    });
  }, [extendedDb]);

  useEffect(() => {
    readerViewRef.current?.postMessage(
      JSON.stringify({ type: "setPageAnimations", enabled: settings.pageAnimations }),
    );
  }, [settings.pageAnimations]);

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
        hasFuriganaActive(sourceDefault, showNames, showCounters, ruleLevels, bookHasSource);

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
          return;
        }
        setMissingBook(false);
        setBook(nextBook);
        fontSizeRef.current = nextBook.fontSize;
        setFontSize(nextBook.fontSize);
        lastPersistedCharOffsetRef.current = nextBook.charOffset;
        lastPersistedReadCompleteRef.current = !!nextBook.readComplete;
        pendingReadCompleteRef.current = !!nextBook.readComplete;

        const rawContent = nextBook.rawContent;
        const hasSource = bookHasSourceFurigana(rawContent);
        hasSourceFuriganaRef.current = hasSource;
        setHasSourceFurigana(hasSource);
        clearBaseAndTransformCaches();

        const hasRubyTags = /<ruby[>\s]/.test(rawContent);
        load = beginReaderLoad(
          buildReaderLoadSequence({
            needsParsing: !hasRubyTags,
            needsFurigana:
              !hasRubyTags &&
              hasInjectedFuriganaActive(
                settings.readerNameFurigana,
                settings.readerCounterFurigana,
                settings.furiganaRuleLevels,
              ),
          }),
        );
        const activeLoad = load;

        if (hasRubyTags) {
          modelRef.current = null;
          updateReaderLoadStage(activeLoad.token, activeLoad.stages, "generatingPages");
          const { content, hasFuri } = await renderPreformattedReaderContent({
            rawContent,
            sourceDefault: settings.sourceFuriganaEnabled,
            showNames: settings.readerNameFurigana,
            showCounters: settings.readerCounterFurigana,
            ruleLevels: settings.furiganaRuleLevels,
          });
          currentReaderContentHtmlRef.current = content;
          const readerHtml = generateReaderHtml(content, {
            fontSize: nextBook.fontSize,
            isDark,
            scrollPosition: nextBook.scrollPosition,
            hasFurigana: hasFuri,
            pageAnimations: settings.pageAnimations,
          });
          appliedTransformSettingsRef.current = getCurrentTransformSettingsSnapshot();
          setHtml(readerHtml);
        } else {
          updateReaderLoadStage(activeLoad.token, activeLoad.stages, "parsing");
          const isAozora = hasAozoraMarkup(rawContent);
          const stripped = isAozora ? stripAozoraBoilerplate(rawContent) : rawContent;
          const format: BookFormat = isAozora ? "aozora" : "plain";
          const model = parseBookContent(stripped, format);

          const screen = Dimensions.get("window");
          const hasFuri = hasFuriganaActive(
            settings.sourceFuriganaEnabled,
            settings.readerNameFurigana,
            settings.readerCounterFurigana,
            settings.furiganaRuleLevels,
            isAozora,
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

          if (
            !dictDb &&
            hasInjectedFuriganaActive(
              settings.readerNameFurigana,
              settings.readerCounterFurigana,
              settings.furiganaRuleLevels,
            )
          ) {
            warnOnce(
              "missing-dictdb-furigana",
              "Injected furigana requested, but no dictionary backend was provided. Reader will render without injected furigana.",
              onMissingCapabilityWarning,
            );
          }

          const injectedFuriganaSet = dictDb
            ? await buildInjectedFuriganaKanjiSet(
                dictDb,
                settings.furiganaRuleLevels,
                settings.readerNameFurigana,
                settings.readerCounterFurigana,
              )
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
            sourceDefault: settings.sourceFuriganaEnabled,
            ruleLevels: settings.furiganaRuleLevels,
            includeCounters: settings.readerCounterFurigana,
            includeNames: settings.readerNameFurigana,
            onStage: (stage) => updateReaderLoadStage(activeLoad.token, activeLoad.stages, stage),
          });
          currentReaderContentHtmlRef.current = sliceHtml;

          const readerHtml = generateReaderHtml(sliceHtml, {
            fontSize: nextBook.fontSize,
            isDark,
            targetLocalChar,
            sliceCharOffset: startChar,
            totalChars: model.totalChars,
            hasFurigana: hasFuri,
            pageAnimations: settings.pageAnimations,
          });
          if (nextBook.totalChars === 0) {
            await bookSource.saveProgress({
              bookId,
              charOffset,
              totalChars: model.totalChars,
              readComplete: !!nextBook.readComplete,
            });
          }
          appliedTransformSettingsRef.current = getCurrentTransformSettingsSnapshot();
          setHtml(readerHtml);
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
    getCurrentTransformSettingsSnapshot,
    isDark,
    onMissingCapabilityWarning,
    renderPreformattedReaderContent,
    renderSliceHtml,
    settings,
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
      previousSnapshot.furiganaRuleLevelsKey !== nextSnapshot.furiganaRuleLevelsKey;
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
            sourceDefault: settings.sourceFuriganaEnabled,
            showNames: settings.readerNameFurigana,
            showCounters: settings.readerCounterFurigana,
            ruleLevels: settings.furiganaRuleLevels,
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
                settings.furiganaRuleLevels,
                settings.readerNameFurigana,
                settings.readerCounterFurigana,
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
    settings,
    syncBookmarkHighlights,
    updateReaderLoadStage,
  ]);

  useEffect(() => {
    if (html === null) return;
    void syncBookmarkHighlights();
  }, [bookmarks?.version, html, settings.readerBookmarkHighlights, syncBookmarkHighlights]);

  useEffect(() => {
    return () => {
      if (bookId && scrollPosRef.current > 0) void flushReadingProgress();
    };
  }, [bookId, flushReadingProgress]);

  const closeLookupPopup = useCallback(() => {
    setShowLookupPopup(false);
    setLookupResults([]);
    setLookupLoading(false);
    setLookupError(null);
    setCopyTooltip(null);
    setCopied(false);
    readerViewRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
    readerViewRef.current?.focus();
  }, []);

  const handleMessage = useCallback(
    async (data: string) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "tap" || msg.type === "selection") {
          const text = msg.text as string;
          if (!text || text.length === 0) return;

          const currentLookupMode = lookupModeRef.current;
          const isNameMode = currentLookupMode === "name";
          const isAutoMode = currentLookupMode === "auto";

          if (isNameMode && !extendedDb) return;
          if ((currentLookupMode === "word" || isAutoMode) && !dictDb) return;

          setLookupResults([]);
          setLookupLoading(true);
          setLookupError(null);
          setShowLookupPopup(true);
          setCopyTooltip(null);
          setCopied(false);

          if (msg.type === "selection") {
            setCopyTooltip({
              text,
              x: msg.startX ?? 0,
              y: msg.startY ?? 0,
            });
            if (isNameMode) {
              const names = await nameLookup(text, extendedDb!);
              setLookupResults(names);
            } else if (isAutoMode) {
              const results = await autoSelectionLookup(text, dictDb!, extendedDb, {
                prefix: msg.prefix || "",
                suffix: msg.suffix || "",
              });
              setLookupResults(results);
            } else {
              await selectionLookup(
                text,
                dictDb!,
                (result) => {
                  setLookupResults((prev) => [...prev, result]);
                },
                { prefix: msg.prefix || "", suffix: msg.suffix || "", extendedDb },
              );
            }
          } else {
            pendingTapPos.current = { x: msg.x ?? 0, y: msg.y ?? 0 };
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

            if (results.length > 0) {
              const matchStart = results[0].matchStart ?? (tapOffset || 0);
              const startDelta = matchStart - (tapOffset || 0);
              readerViewRef.current?.postMessage(
                JSON.stringify({
                  type: "highlight",
                  start: startDelta,
                  length: results[0].matchedText.length,
                }),
              );
            }

            if (pendingTapPos.current) {
              const tappedText = results.length > 0 ? results[0].matchedText : text;
              setCopyTooltip({
                text: tappedText,
                x: pendingTapPos.current.x,
                y: pendingTapPos.current.y,
              });
            }
          }
          setLookupLoading(false);
        } else if (msg.type === "error") {
          setLookupResults([]);
          setLookupLoading(false);
          setLookupError(msg.message || "An error occurred");
          setShowLookupPopup(true);
        } else if (msg.type === "scroll") {
          scrollPosRef.current = msg.charOffset;
          pendingReadCompleteRef.current = !!msg.isLastPage;
          const flushMode = getReaderProgressFlushMode({
            initialScrollHandled: initialScrollFiredRef.current,
            isLastPage: !!msg.isLastPage,
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
            currentReaderContentHtmlRef.current += nextHtml;
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
        }
      } catch {}
    },
    [dictDb, extendedDb, renderSliceHtml, scheduleReadingProgressFlush, syncBookmarkHighlights],
  );

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
      pageAnimations: settings.pageAnimations,
      sourceFuriganaEnabled: settings.sourceFuriganaEnabled,
      readerCounterFurigana: settings.readerCounterFurigana,
      readerNameFurigana: settings.readerNameFurigana,
      readerBookmarkHighlights: settings.readerBookmarkHighlights,
      furiganaRuleLevels: cloneRuleLevels(settings.furiganaRuleLevels),
    }),
    [settings],
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
    readerViewProps: html ? { html, onMessage: handleMessage } : null,
    loadingState,
    lookupResults,
    lookupLoading,
    lookupError,
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
  };
}
