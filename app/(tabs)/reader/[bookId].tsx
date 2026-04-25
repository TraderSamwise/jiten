import React, { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Animated,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Easing,
  Linking,
  Platform,
  ScrollView,
  Switch,
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { CustomHeaderScreen, useWebBackdrop } from "@/components/CustomHeaderScreen";
import { Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { DictionaryPopup } from "@/components/DictionaryPopup";
import { ReaderView, type ReaderViewRef } from "@/components/ReaderView";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  BookText,
  User,
  Download,
  Trash2,
} from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import {
  parseAozoraToHtml,
  hasAozoraMarkup,
  plainTextToHtml,
  stripAozoraBoilerplate,
} from "@/lib/aozora-parser";
import {
  type BookFormat,
  type TextModel,
  generateReaderHtml,
  getReaderProgressFlushMode,
  getSelectionToolbarPosition,
  parseBookContent,
  sliceContent,
  calcCharsPerPage,
} from "@jiten/japanese-reader-core";
import {
  smartLookup,
  smartLookupWithOffset,
  selectionLookup,
  autoLookup,
  autoLookupWithOffset,
  autoSelectionLookup,
  nameLookup,
  nameLookupWithOffset,
  type LookupResult,
  type ReaderLookupMode,
} from "@/lib/smart-lookup";
import { useAtom } from "jotai";
import {
  readerFuriganaRuleLevelsAtom,
  readerCounterFuriganaAtom,
  readerNameFuriganaAtom,
  readerSourceFuriganaAtom,
  readerPageAnimationsAtom,
  type FuriganaMatchLevel,
  type ReaderFuriganaRule,
} from "@/stores/settings";
import {
  buildFuriganaKanjiSet,
  extractSurfacesFromHtml,
  resolveFuriganaBatch,
  applyFuriganaToHtml,
  injectRubySpacers,
  type FuriganaKanjiSet,
  type FuriganaEntry,
} from "@/lib/reader-furigana";
import { parseBookRow } from "./index";
import { useSync } from "@/db/sync-provider";
import type { Book } from "@/db/types";

/** Does this book's raw content contain source furigana? */
function bookHasSourceFurigana(rawContent: string): boolean {
  return /<ruby[\s>]/.test(rawContent) || hasAozoraMarkup(rawContent);
}

/** Should furigana layout be active? Accounts for source furigana + "default" toggle. */
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
  dictDb: NonNullable<ReturnType<typeof useDatabase>["dictDb"]>,
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

/** Strip <ruby> tags keeping only base text (removes <rt> content) */
function stripRubyTags(html: string): string {
  return html.replace(/<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/g, "$1");
}

const TOOLBAR_GAP = 24;
const POPUP_SAFE_ZONE = 380;
const TOOLBAR_SIDE_MARGIN = 8;
const READ_PROGRESS_FLUSH_MS = 15_000;
const FURIGANA_SETTINGS_APPLY_DEBOUNCE_MS = 180;
const SLICE_RENDER_CACHE_LIMIT = 48;

const EXTERNAL_DICTS = [
  {
    label: "Midori",
    url: (q: string) => `midori://search?text=${q}`,
    store: "https://apps.apple.com/app/midori-japanese-dictionary/id385231773",
  },
  {
    label: "Shirabe Jisho",
    url: (q: string) => `shirabelookup://search?w=${q}`,
    store: "https://apps.apple.com/app/shirabe-jisho/id1005203380",
  },
  {
    label: "DaKanji",
    url: (q: string) => `dakanji://dictionary?search=${q}`,
    store: "https://apps.apple.com/app/dakanji/id1548746810",
  },
  {
    label: "imiwa?",
    url: (q: string) => `imiwa://analyser?text=${q}`,
    store: "https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125",
  },
];

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

function HighlightToolbar({
  tooltip,
  readerY,
  isDark,
  copied,
  onCopy,
}: {
  tooltip: { text: string; x: number; y: number };
  readerY: React.RefObject<number>;
  isDark: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const [openInExpanded, setOpenInExpanded] = useState(false);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const screen = Dimensions.get("window");
  const layoutY = readerY.current ?? 0;
  const toolbarH = openInExpanded ? 76 : 32;
  const estimatedToolbarWidth = openInExpanded ? 260 : 132;
  const { top, left } = getSelectionToolbarPosition({
    anchorX: tooltip.x,
    anchorY: tooltip.y,
    readerTop: layoutY,
    screenWidth: screen.width,
    screenHeight: screen.height,
    toolbarWidth: toolbarWidth || estimatedToolbarWidth,
    toolbarHeight: toolbarH,
    toolbarGap: TOOLBAR_GAP,
    popupSafeZone: POPUP_SAFE_ZONE,
    sideMargin: TOOLBAR_SIDE_MARGIN,
  });

  const bg = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
  const fg = isDark ? "#000" : "#fff";

  function handleToolbarLayout(e: LayoutChangeEvent) {
    const nextWidth = Math.round(e.nativeEvent.layout.width);
    setToolbarWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  }

  return (
    <View
      style={{
        position: "absolute",
        zIndex: 101,
        top,
        left,
      }}
      pointerEvents="box-none"
    >
      <View
        onLayout={handleToolbarLayout}
        style={{
          backgroundColor: bg,
          borderRadius: 16,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
          paddingVertical: 6,
          paddingHorizontal: 4,
        }}
      >
        {/* Main row: Copy + Open in */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Pressable onPress={onCopy} style={{ paddingHorizontal: 10, paddingVertical: 2 }}>
            <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>
              {copied ? "Copied!" : "Copy"}
            </Text>
          </Pressable>
          {Platform.OS === "ios" && (
            <>
              <View style={{ width: 1, height: 16, backgroundColor: fg, opacity: 0.3 }} />
              <Pressable
                onPress={() => setOpenInExpanded(!openInExpanded)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>Open in</Text>
                <ChevronDown
                  size={14}
                  color={fg}
                  style={{
                    marginLeft: 2,
                    transform: [{ rotate: openInExpanded ? "180deg" : "0deg" }],
                  }}
                />
              </Pressable>
            </>
          )}
        </View>
        {/* Expanded: external dict buttons */}
        {openInExpanded && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 4,
              marginTop: 6,
              paddingHorizontal: 4,
            }}
          >
            {EXTERNAL_DICTS.map((d) => (
              <Pressable
                key={d.label}
                onPress={() => {
                  const encoded = encodeURIComponent(tooltip.text);
                  Linking.openURL(d.url(encoded)).catch(() => {
                    Linking.openURL(d.store);
                  });
                }}
                style={{
                  backgroundColor: fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: bg, fontSize: 11, fontWeight: "600" }}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function JumpSlider({
  initialPercent,
  isDark,
  onJump,
  onDismiss,
}: {
  initialPercent: number;
  isDark: boolean;
  onJump: (percent: number) => void;
  onDismiss: () => void;
}) {
  const [percent, setPercent] = useState(initialPercent);
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);
  const trackXRef = useRef(0);

  const updateFromPageX = (pageX: number) => {
    const x = pageX - trackXRef.current;
    const clamped = Math.max(0, Math.min(x, trackWidthRef.current));
    // RTL: right edge = 0%, left edge = 100%
    const pct =
      trackWidthRef.current > 0
        ? ((trackWidthRef.current - clamped) / trackWidthRef.current) * 100
        : 0;
    setPercent(Math.round(pct));
  };

  const pctFromTouch = (pageX: number) => {
    const x = pageX - trackXRef.current;
    const clamped = Math.max(0, Math.min(x, trackWidthRef.current));
    return trackWidthRef.current > 0
      ? Math.round(((trackWidthRef.current - clamped) / trackWidthRef.current) * 100)
      : 0;
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    setPercent(pctFromTouch(pageX));
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    setPercent(pctFromTouch(pageX));
  };

  const handleTouchEnd = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    const pct = pctFromTouch(pageX);
    setPercent(pct);
    onJump(pct);
  };

  const bg = isDark ? "#1c1c1e" : "#f2f2f7";
  const trackBg = isDark ? "#3a3a3c" : "#d1d1d6";
  const fillColor = isDark ? "#0a84ff" : "#007aff";
  const textColor = isDark ? "#fff" : "#000";

  return (
    <Pressable
      onPress={onDismiss}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
        justifyContent: "flex-end",
      }}
    >
      <Pressable
        onPress={(e) => e.stopPropagation()}
        style={{
          backgroundColor: bg,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 32,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 10,
        }}
      >
        <Text
          style={{
            color: textColor,
            fontSize: 18,
            fontWeight: "600",
            textAlign: "center",
            marginBottom: 12,
            fontVariant: ["tabular-nums"],
          }}
        >
          {percent}%
        </Text>
        <View
          ref={trackRef}
          onLayout={() => {
            trackRef.current?.measureInWindow((x, _y, width) => {
              trackXRef.current = x;
              trackWidthRef.current = width;
            });
          }}
          style={{
            height: 36,
            justifyContent: "center",
          }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouchStart}
          onResponderMove={handleTouchMove}
          onResponderRelease={handleTouchEnd}
        >
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: trackBg,
              overflow: "hidden",
              flexDirection: "row-reverse",
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: fillColor,
                width: `${percent}%`,
              }}
            />
          </View>
          {/* Thumb */}
          <View
            style={{
              position: "absolute",
              right: `${percent}%`,
              marginRight: -14,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#fff",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.3,
              shadowRadius: 3,
              elevation: 4,
            }}
          />
        </View>
      </Pressable>
    </Pressable>
  );
}

export default function BookReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const goBack = useSafeGoBack("/reader");
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const userDb = useUserDb();
  const { dictDb, extendedDb } = useDatabase();
  const { markDirty, triggerSync } = useSync();
  // Track whether the initial scroll-restore has fired (don't mark dirty for it)
  const initialScrollFiredRef = useRef(false);
  const readerRef = useRef<ReaderViewRef>(null);
  const [sourceFuriganaEnabled, setSourceFuriganaEnabled] = useAtom(readerSourceFuriganaAtom);
  const [readerCounterFurigana, setReaderCounterFurigana] = useAtom(readerCounterFuriganaAtom);
  const [readerNameFurigana, setReaderNameFurigana] = useAtom(readerNameFuriganaAtom);
  const [furiganaRuleLevels, setFuriganaRuleLevels] = useAtom(readerFuriganaRuleLevelsAtom);
  const [pageAnimations, setPageAnimations] = useAtom(readerPageAnimationsAtom);
  const [draftSourceFuriganaEnabled, setDraftSourceFuriganaEnabled] =
    useState(sourceFuriganaEnabled);
  const [draftReaderCounterFurigana, setDraftReaderCounterFurigana] =
    useState(readerCounterFurigana);
  const [draftReaderNameFurigana, setDraftReaderNameFurigana] = useState(readerNameFurigana);
  const [draftFuriganaRuleLevels, setDraftFuriganaRuleLevels] = useState(furiganaRuleLevels);

  const [book, setBook] = useState<Book | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(22);
  const [copyTooltip, setCopyTooltip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [lookupMode, setLookupMode] = useState<ReaderLookupMode>("auto");
  const lookupModeRef = useRef<ReaderLookupMode>("auto");
  const [showJumpSlider, setShowJumpSlider] = useState(false);
  const [showAdvancedReadingPatterns, setShowAdvancedReadingPatterns] = useState(false);
  const [advancedReadingPatternsHeight, setAdvancedReadingPatternsHeight] = useState(0);
  const advancedReadingPatternsAnim = useRef(new Animated.Value(0)).current;
  const furiganaApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(advancedReadingPatternsAnim, {
      toValue: showAdvancedReadingPatterns ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [advancedReadingPatternsAnim, showAdvancedReadingPatterns]);

  useEffect(() => {
    if (showSettings) {
      setDraftSourceFuriganaEnabled(sourceFuriganaEnabled);
      setDraftReaderCounterFurigana(readerCounterFurigana);
      setDraftReaderNameFurigana(readerNameFurigana);
      setDraftFuriganaRuleLevels(furiganaRuleLevels);
      return;
    }
    setDraftSourceFuriganaEnabled(sourceFuriganaEnabled);
    setDraftReaderCounterFurigana(readerCounterFurigana);
    setDraftReaderNameFurigana(readerNameFurigana);
    setDraftFuriganaRuleLevels(furiganaRuleLevels);
  }, [
    showSettings,
    sourceFuriganaEnabled,
    readerCounterFurigana,
    readerNameFurigana,
    furiganaRuleLevels,
  ]);

  const flushDraftFuriganaSettings = useCallback(() => {
    if (furiganaApplyTimerRef.current) {
      clearTimeout(furiganaApplyTimerRef.current);
      furiganaApplyTimerRef.current = null;
    }
    if (draftSourceFuriganaEnabled !== sourceFuriganaEnabled) {
      startTransition(() => {
        setSourceFuriganaEnabled(draftSourceFuriganaEnabled);
      });
    }
    if (draftReaderCounterFurigana !== readerCounterFurigana) {
      startTransition(() => {
        setReaderCounterFurigana(draftReaderCounterFurigana);
      });
    }
    if (draftReaderNameFurigana !== readerNameFurigana) {
      startTransition(() => {
        setReaderNameFurigana(draftReaderNameFurigana);
      });
    }
    if (!ruleLevelsEqual(draftFuriganaRuleLevels, furiganaRuleLevels)) {
      startTransition(() => {
        setFuriganaRuleLevels(draftFuriganaRuleLevels);
      });
    }
  }, [
    draftFuriganaRuleLevels,
    draftReaderCounterFurigana,
    draftReaderNameFurigana,
    draftSourceFuriganaEnabled,
    furiganaRuleLevels,
    readerCounterFurigana,
    readerNameFurigana,
    setFuriganaRuleLevels,
    setReaderCounterFurigana,
    setReaderNameFurigana,
    setSourceFuriganaEnabled,
    sourceFuriganaEnabled,
  ]);

  useEffect(() => {
    if (!showSettings) return;
    if (
      draftReaderCounterFurigana === readerCounterFurigana &&
      draftReaderNameFurigana === readerNameFurigana &&
      draftSourceFuriganaEnabled === sourceFuriganaEnabled &&
      ruleLevelsEqual(draftFuriganaRuleLevels, furiganaRuleLevels)
    ) {
      if (furiganaApplyTimerRef.current) {
        clearTimeout(furiganaApplyTimerRef.current);
        furiganaApplyTimerRef.current = null;
      }
      return;
    }
    if (furiganaApplyTimerRef.current) clearTimeout(furiganaApplyTimerRef.current);
    furiganaApplyTimerRef.current = setTimeout(() => {
      furiganaApplyTimerRef.current = null;
      flushDraftFuriganaSettings();
    }, FURIGANA_SETTINGS_APPLY_DEBOUNCE_MS);
    return () => {
      if (furiganaApplyTimerRef.current) {
        clearTimeout(furiganaApplyTimerRef.current);
        furiganaApplyTimerRef.current = null;
      }
    };
  }, [
    draftFuriganaRuleLevels,
    draftReaderCounterFurigana,
    draftReaderNameFurigana,
    draftSourceFuriganaEnabled,
    flushDraftFuriganaSettings,
    furiganaRuleLevels,
    readerCounterFurigana,
    readerNameFurigana,
    showSettings,
    sourceFuriganaEnabled,
  ]);

  useEffect(() => {
    return () => {
      if (furiganaApplyTimerRef.current) {
        clearTimeout(furiganaApplyTimerRef.current);
      }
    };
  }, []);

  const toggleSettings = useCallback(() => {
    setShowSettings((prev) => {
      if (prev) {
        flushDraftFuriganaSettings();
      }
      return !prev;
    });
  }, [flushDraftFuriganaSettings]);

  // Streaming prefetch refs — used by handleMessage for pageRendered
  const modelRef = useRef<TextModel | null>(null);
  const sliceCharOffsetRef = useRef(0);
  const fwdLoadedEndRef = useRef(0); // furthest global char loaded into WebView
  const isAozoraRef = useRef(false);
  const backPrefetchingRef = useRef(false);

  // Furigana refs
  const kanjiSetRef = useRef<FuriganaKanjiSet | null>(null);
  const sourceFuriganaEnabledRef = useRef(sourceFuriganaEnabled);
  const readerCounterFuriganaRef = useRef(readerCounterFurigana);
  const readerNameFuriganaRef = useRef(readerNameFurigana);
  const furiganaRuleLevelsRef = useRef(furiganaRuleLevels);
  const hasSourceFuriganaRef = useRef(false);
  const [hasSourceFurigana, setHasSourceFurigana] = useState(false);
  const furiganaEntryCacheRef = useRef<Map<string, FuriganaEntry | null>>(new Map());
  const sliceRenderCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    sourceFuriganaEnabledRef.current = sourceFuriganaEnabled;
  }, [sourceFuriganaEnabled]);
  useEffect(() => {
    readerCounterFuriganaRef.current = readerCounterFurigana;
  }, [readerCounterFurigana]);
  useEffect(() => {
    readerNameFuriganaRef.current = readerNameFurigana;
  }, [readerNameFurigana]);
  useEffect(() => {
    furiganaRuleLevelsRef.current = furiganaRuleLevels;
  }, [furiganaRuleLevels]);
  useEffect(() => {
    lookupModeRef.current = lookupMode;
  }, [lookupMode]);

  const getRuleLevelsCacheKey = useCallback(
    (ruleLevels: Record<ReaderFuriganaRule, Record<FuriganaMatchLevel, boolean>>) =>
      JSON.stringify(ruleLevels),
    [],
  );

  const setCachedSliceHtml = useCallback((key: string, html: string) => {
    const cache = sliceRenderCacheRef.current;
    cache.delete(key);
    cache.set(key, html);
    while (cache.size > SLICE_RENDER_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey == null) break;
      cache.delete(oldestKey);
    }
  }, []);

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
    }) => {
      const cacheKey = [
        isAozora ? "a" : "p",
        startChar,
        charCount,
        hasFuri ? 1 : 0,
        sourceDefault ? 1 : 0,
        includeCounters ? 1 : 0,
        includeNames ? 1 : 0,
        getRuleLevelsCacheKey(ruleLevels),
      ].join(":");
      const cachedHtml = sliceRenderCacheRef.current.get(cacheKey);
      if (cachedHtml != null) {
        setCachedSliceHtml(cacheKey, cachedHtml);
        return cachedHtml;
      }

      let sliceHtml = isAozora
        ? parseAozoraToHtml(sliceText, { strip: false })
        : plainTextToHtml(sliceText);

      if (isAozora && !hasFuri) {
        sliceHtml = stripRubyTags(sliceHtml);
      }

      if (kanjiSetRef.current && dictDb) {
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
      }

      setCachedSliceHtml(cacheKey, sliceHtml);
      return sliceHtml;
    },
    [dictDb, extendedDb, getRuleLevelsCacheKey, setCachedSliceHtml],
  );

  const cycleLookupMode = useCallback(() => {
    setLookupMode((prev) => {
      if (prev === "auto") return "name";
      if (prev === "name") return "word";
      return extendedDb ? "auto" : "word";
    });
  }, [extendedDb]);

  // Send page animations setting to WebView when it changes
  useEffect(() => {
    readerRef.current?.postMessage(
      JSON.stringify({ type: "setPageAnimations", enabled: pageAnimations }),
    );
  }, [pageAnimations]);

  // Reload the reader at a given char offset (used by furigana toggle + jump slider)
  const reloadAtChar = useCallback(
    async (charOffset: number) => {
      const model = modelRef.current;
      if (!model || !dictDb) return;
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
      const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
      const startChar = Math.max(0, charOffset - cpp * 10);
      const totalBudget = charOffset - startChar + cpp * 3;
      const slice = sliceContent(model, startChar, totalBudget);
      const targetLocalChar = charOffset - startChar;

      sliceCharOffsetRef.current = startChar;
      fwdLoadedEndRef.current = Math.min(startChar + totalBudget, model.totalChars);
      backPrefetchingRef.current = false;

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
      });

      readerRef.current?.postMessage(
        JSON.stringify({
          type: "reloadContent",
          html: sliceHtml,
          sliceCharOffset: startChar,
          targetLocalChar,
          lineHeight: hasFuri ? `${fontSize * 2}px` : `${Math.round(fontSize * 1.5)}px`,
          hasFurigana: hasFuri,
        }),
      );
    },
    [fontSize, renderSliceHtml],
  );

  // Track scroll position for saving
  const scrollPosRef = useRef(0);
  const pendingReadCompleteRef = useRef(false);
  const lastPersistedCharOffsetRef = useRef(0);
  const lastPersistedReadCompleteRef = useRef(false);
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track ReaderView's Y offset in screen coordinates
  const readerLayoutY = useRef(0);
  // Store tap position while waiting for lookup results
  const pendingTapPos = useRef<{ x: number; y: number } | null>(null);

  const flushReadingProgress = useCallback(async () => {
    if (!userDb || !bookId) return;

    const charOffset = scrollPosRef.current;
    const readComplete = pendingReadCompleteRef.current;
    if (
      charOffset === lastPersistedCharOffsetRef.current &&
      readComplete === lastPersistedReadCompleteRef.current
    ) {
      return;
    }

    await userDb.runAsync(
      "UPDATE books SET char_offset = ?, read_complete = ?, updated_at = ? WHERE id = ?",
      [charOffset, readComplete ? 1 : 0, new Date().toISOString(), bookId],
    );
    lastPersistedCharOffsetRef.current = charOffset;
    lastPersistedReadCompleteRef.current = readComplete;
    markDirty();
  }, [bookId, markDirty, userDb]);

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

  // Load book
  useEffect(() => {
    if (!userDb || !bookId) return;
    (async () => {
      const row = await userDb.getFirstAsync<any>("SELECT * FROM books WHERE id = ?", [bookId]);
      if (!row) {
        goBack();
        return;
      }
      const b = parseBookRow(row);
      setBook(b);
      setFontSize(b.fontSize);
      lastPersistedCharOffsetRef.current = b.charOffset;
      lastPersistedReadCompleteRef.current = !!b.readComplete;
      pendingReadCompleteRef.current = !!b.readComplete;

      if (!b.rawContent) {
        goBack();
        return;
      }

      // Detect source furigana
      const hasSource = bookHasSourceFurigana(b.rawContent);
      hasSourceFuriganaRef.current = hasSource;
      setHasSourceFurigana(hasSource);
      sliceRenderCacheRef.current.clear();
      furiganaEntryCacheRef.current.clear();

      // If content already has <ruby> HTML tags (e.g. from Aozora XHTML), use as-is
      const hasRubyTags = /<ruby[>\s]/.test(b.rawContent);

      if (hasRubyTags) {
        // Pre-formatted HTML — send entire content (no slicing)
        const hasFuri = hasFuriganaActive(
          sourceFuriganaEnabled,
          readerNameFurigana,
          readerCounterFurigana,
          furiganaRuleLevels,
          true,
        );
        let content = b.rawContent;
        if (!hasFuri) {
          content = stripRubyTags(content);
        }
        const readerHtml = generateReaderHtml(content, {
          fontSize: b.fontSize,
          isDark,
          scrollPosition: b.scrollPosition,
          hasFurigana: hasFuri,
          pageAnimations,
        });
        setHtml(readerHtml);
      } else {
        // Aozora or plain text — slice ~3 pages from char offset
        const isAozora = hasAozoraMarkup(b.rawContent);
        const stripped = isAozora ? stripAozoraBoilerplate(b.rawContent) : b.rawContent;
        const format: BookFormat = isAozora ? "aozora" : "plain";
        const model = parseBookContent(stripped, format);

        const screen = Dimensions.get("window");
        const hasFuri = hasFuriganaActive(
          sourceFuriganaEnabled,
          readerNameFurigana,
          readerCounterFurigana,
          furiganaRuleLevels,
          isAozora,
        );
        const cpp = calcCharsPerPage(screen.width, screen.height, b.fontSize, hasFuri);

        // Legacy conversion: scroll_position → char_offset
        let charOffset = b.charOffset;
        if (charOffset === 0 && b.scrollPosition > 0) {
          charOffset = Math.round(b.scrollPosition * model.totalChars);
        }

        const startChar = Math.max(0, charOffset - cpp * 10);
        const totalBudget = charOffset - startChar + cpp * 3;
        const slice = sliceContent(model, startChar, totalBudget);
        const targetLocalChar = charOffset - startChar;

        // Store refs for streaming prefetch
        modelRef.current = model;
        sliceCharOffsetRef.current = startChar;
        fwdLoadedEndRef.current = Math.min(startChar + totalBudget, model.totalChars);
        isAozoraRef.current = isAozora;

        // Save total_chars on first load
        if (b.totalChars === 0) {
          const now = new Date().toISOString();
          userDb.runAsync("UPDATE books SET total_chars = ?, updated_at = ? WHERE id = ?", [
            model.totalChars,
            now,
            bookId,
          ]);
        }

        // Apply injected furigana if any rule has selected levels
        const injectedFuriganaSet = dictDb
          ? await buildInjectedFuriganaKanjiSet(
              dictDb,
              furiganaRuleLevels,
              readerNameFurigana,
              readerCounterFurigana,
            )
          : null;
        kanjiSetRef.current = injectedFuriganaSet;
        furiganaEntryCacheRef.current.clear();
        const sliceHtml = await renderSliceHtml({
          sliceText: slice.text,
          startChar,
          charCount: slice.text.length,
          isAozora,
          hasFuri,
          sourceDefault: sourceFuriganaEnabled,
          ruleLevels: furiganaRuleLevels,
          includeCounters: readerCounterFurigana,
          includeNames: readerNameFurigana,
        });

        const readerHtml = generateReaderHtml(sliceHtml, {
          fontSize: b.fontSize,
          isDark,
          targetLocalChar,
          sliceCharOffset: startChar,
          totalChars: model.totalChars,
          hasFurigana: hasFuri,
          pageAnimations,
        });
        setHtml(readerHtml);
      }

      // Update last_read_at
      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE books SET last_read_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        bookId,
      ]);
    })();
  }, [userDb, bookId, isDark, goBack, renderSliceHtml]);

  // Re-apply furigana when levels change
  useEffect(() => {
    if (!book || !dictDb || !modelRef.current || html === null) return;
    (async () => {
      kanjiSetRef.current = await buildInjectedFuriganaKanjiSet(
        dictDb,
        furiganaRuleLevels,
        readerNameFurigana,
        readerCounterFurigana,
      );
      furiganaEntryCacheRef.current.clear();
      sliceRenderCacheRef.current.clear();

      const charOffset = scrollPosRef.current || 0;
      await reloadAtChar(charOffset);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceFuriganaEnabled,
    readerCounterFurigana,
    readerNameFurigana,
    furiganaRuleLevels,
    dictDb,
  ]);

  // Save char offset on unmount
  useEffect(() => {
    return () => {
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current);
        progressFlushTimerRef.current = null;
      }
      if (userDb && bookId && scrollPosRef.current > 0) {
        void flushReadingProgress();
      }
    };
  }, [bookId, flushReadingProgress, userDb]);

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
          setShowPopup(true);
          setCopyTooltip(null);
          setCopied(false);

          if (msg.type === "selection") {
            // Show copy tooltip immediately for selections
            setCopyTooltip({
              text,
              x: msg.startX ?? 0,
              y: msg.startY ?? 0,
            });
            if (isNameMode) {
              // In name mode, just do a simple name lookup on the full selection
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
                { prefix: msg.prefix || "", suffix: msg.suffix || "" },
              );
            }
          } else {
            // Store tap position; tooltip shown after lookup
            pendingTapPos.current = { x: msg.x ?? 0, y: msg.y ?? 0 };
            const tapOffset = msg.tapOffset as number | undefined;
            let results: LookupResult[];

            if (isNameMode) {
              results =
                tapOffset && tapOffset > 0
                  ? await nameLookupWithOffset(text, tapOffset, extendedDb!)
                  : await nameLookup(text, extendedDb!);
            } else if (isAutoMode) {
              results =
                tapOffset && tapOffset > 0
                  ? await autoLookupWithOffset(text, tapOffset, dictDb!, extendedDb)
                  : await autoLookup(text, dictDb!, extendedDb);
            } else {
              results =
                tapOffset && tapOffset > 0
                  ? await smartLookupWithOffset(text, tapOffset, dictDb!)
                  : await smartLookup(text, dictDb!);
            }
            setLookupResults(results);

            // Highlight matched text in reader (only for taps; selections have native highlight)
            if (results.length > 0) {
              const matchStart = results[0].matchStart ?? (tapOffset || 0);
              const startDelta = matchStart - (tapOffset || 0);
              readerRef.current?.postMessage(
                JSON.stringify({
                  type: "highlight",
                  start: startDelta,
                  length: results[0].matchedText.length,
                }),
              );
            }
            // Show copy tooltip at tap position (even with no results)
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
          setShowPopup(true);
        } else if (msg.type === "scroll") {
          scrollPosRef.current = msg.charOffset;
          pendingReadCompleteRef.current = !!msg.isLastPage;
          const flushMode = getReaderProgressFlushMode({
            initialScrollHandled: initialScrollFiredRef.current,
            isLastPage: !!msg.isLastPage,
            lastPersistedReadComplete: lastPersistedReadCompleteRef.current,
          });
          if (flushMode === "skip") {
            // First scroll event is the position restore on load — skip it
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
            // Forward prefetch — only when content actually needs extending
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
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
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
            readerRef.current?.postMessage(
              JSON.stringify({
                type: "setNextContent",
                html: nextHtml,
                replaceFromChar: msg.lastCharIndex + 1,
              }),
            );
          }

          // Backward prefetch trigger
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
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
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
              readerRef.current?.postMessage(
                JSON.stringify({
                  type: "setPrevContent",
                  html: backHtml,
                  charCount: backChars,
                }),
              );
              sliceCharOffsetRef.current = backStart;
            } else {
              backPrefetchingRef.current = false;
            }
          }
        } else if (msg.type === "backPrefetchDone") {
          backPrefetchingRef.current = false;
        } else if (msg.type === "percentTap") {
          setShowJumpSlider(true);
        }
      } catch {}
    },
    [dictDb, extendedDb, userDb, bookId, fontSize],
  );

  const handleCopy = useCallback(() => {
    if (!copyTooltip) return;
    readerRef.current?.postMessage(
      JSON.stringify({ type: "copyToClipboard", text: copyTooltip.text }),
    );
    setCopied(true);
    setTimeout(() => {
      setCopyTooltip(null);
      setCopied(false);
    }, 800);
  }, [copyTooltip]);

  const handleFontSizeChange = useCallback(
    (newSize: number) => {
      const rounded = Math.round(newSize);
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
      readerRef.current?.postMessage(
        JSON.stringify({ type: "setFontSize", size: rounded, lineHeight }),
      );
      if (userDb && bookId) {
        userDb.runAsync("UPDATE books SET font_size = ?, updated_at = ? WHERE id = ?", [
          rounded,
          new Date().toISOString(),
          bookId,
        ]);
      }
    },
    [userDb, bookId],
  );

  const furiganaRuleSections: {
    title: string;
    rules: [ReaderFuriganaRule, string][];
  }[] = [
    {
      title: "Show When",
      rules: [
        ["matchAnyKanji", "Kanji"],
        ["matchWordLevel", "Word level"],
        ["matchIrregularReading", "Irregular"],
      ],
    },
  ];

  const readingPatternRules: [ReaderFuriganaRule, string][] = [
    ["matchMostlyKunyomi", "Mostly kunyomi"],
    ["matchMostlyOnyomi", "Mostly onyomi"],
    ["matchMixedOnKun", "Mixed on/kun"],
  ];

  const matchLevelOptions: [FuriganaMatchLevel, string][] = [
    ["n5", "N5"],
    ["n4", "N4"],
    ["n3", "N3"],
    ["n2", "N2"],
    ["n1", "N1"],
    ["nonJouyou", "Other"],
  ];

  const formatSelectedLevels = useCallback(
    (rule: ReaderFuriganaRule) => {
      const labels = matchLevelOptions
        .filter(([level]) => draftFuriganaRuleLevels[rule][level])
        .map(([, label]) => label);
      return labels.length > 0 ? labels.join(" ") : "Off";
    },
    [draftFuriganaRuleLevels],
  );

  const handleToggleSaved = useCallback(async () => {
    if (!userDb || !book) return;
    const newSaved = book.saved === 1 ? 0 : 1;
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE books SET saved = ?, updated_at = ? WHERE id = ?", [
      newSaved,
      now,
      book.id,
    ]);
    setBook({ ...book, saved: newSaved });
    triggerSync();
  }, [userDb, book, triggerSync]);

  const { webBgStyle } = useWebBackdrop(15);

  return (
    <CustomHeaderScreen webTop={15}>
      {/* Header */}
      <View
        className="flex-row items-center px-2 pb-2 border-b border-border bg-background"
        style={webBgStyle}
      >
        <Pressable onPress={() => goBack()} className="p-2">
          <ChevronLeft size={24} className="text-foreground" />
        </Pressable>
        <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
          {book?.title ?? ""}
        </Text>
        {book && book.source !== "import" && (
          <Pressable onPress={handleToggleSaved} className="p-2">
            {book.saved === 1 ? (
              <Trash2 size={20} className="text-muted-foreground" />
            ) : (
              <Download size={20} className="text-muted-foreground" />
            )}
          </Pressable>
        )}
        {book && extendedDb && (
          <Pressable onPress={cycleLookupMode} className="min-w-[40px] items-center px-2 py-1">
            {lookupMode === "name" ? (
              <User size={20} className="text-primary" />
            ) : lookupMode === "word" ? (
              <BookText size={20} className="text-primary" />
            ) : (
              <Text className="text-sm font-semibold text-primary">Auto</Text>
            )}
          </Pressable>
        )}
        {book && (
          <Pressable onPress={toggleSettings} className="p-2">
            <SlidersHorizontal size={20} className="text-foreground" />
          </Pressable>
        )}
      </View>

      {!book || !html ? (
        <View
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: isDark ? "#18181b" : "#fafaf9" }}
        >
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <>
          {/* Reader content */}
          <View
            style={{ flex: 1 }}
            onLayout={(e) => {
              readerLayoutY.current = e.nativeEvent.layout.y;
            }}
          >
            <ReaderView ref={readerRef} html={html} onMessage={handleMessage} />
            {/* Settings overlay — positioned absolute so it doesn't resize the reader */}
            {showSettings && (
              <ScrollView
                className="absolute left-0 right-0 top-0 px-4 py-3 border-b border-border bg-background gap-3"
                style={{ zIndex: 10, maxHeight: "100%" }}
                contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              >
                <View className="flex-row items-center justify-center gap-4">
                  <Pressable
                    onPress={() => handleFontSizeChange(Math.max(14, fontSize - 1))}
                    disabled={fontSize <= 14}
                    className={`h-10 w-10 items-center justify-center rounded-lg border border-border ${fontSize <= 14 ? "opacity-30" : ""}`}
                  >
                    <Text className="text-lg text-foreground">A-</Text>
                  </Pressable>
                  <Text className="text-base text-foreground w-8 text-center">{fontSize}</Text>
                  <Pressable
                    onPress={() => handleFontSizeChange(Math.min(32, fontSize + 1))}
                    disabled={fontSize >= 32}
                    className={`h-10 w-10 items-center justify-center rounded-lg border border-border ${fontSize >= 32 ? "opacity-30" : ""}`}
                  >
                    <Text className="text-lg text-foreground">A+</Text>
                  </Pressable>
                </View>

                <Separator className="opacity-40" />

                {furiganaRuleSections.map(({ title, rules }) => (
                  <View key={title} className="gap-2">
                    <Text className="text-xs text-muted-foreground text-center uppercase tracking-wide">
                      {title === "Show When" ? "Show Furigana" : title}
                    </Text>
                    {rules.map(([rule, label]) => (
                      <View
                        key={rule}
                        className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 gap-2"
                      >
                        <View className="flex-row items-center justify-between gap-3">
                          <Text className="text-sm font-medium text-foreground">{label}</Text>
                          <Text className="text-[11px] text-muted-foreground">
                            {formatSelectedLevels(rule)}
                          </Text>
                        </View>
                        <View className="flex-row flex-wrap gap-1.5">
                          {matchLevelOptions.map(([level, levelLabel]) => (
                            <Pressable
                              key={`${rule}-${level}`}
                              onPress={() =>
                                setDraftFuriganaRuleLevels((prev) => ({
                                  ...prev,
                                  [rule]: {
                                    ...prev[rule],
                                    [level]: !prev[rule][level],
                                  },
                                }))
                              }
                              className={`px-3 py-1.5 rounded-full border ${
                                draftFuriganaRuleLevels[rule][level]
                                  ? "bg-foreground border-foreground"
                                  : "bg-background/40 border-border"
                              }`}
                            >
                              <Text
                                className={`text-xs font-medium ${
                                  draftFuriganaRuleLevels[rule][level]
                                    ? "text-background"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {levelLabel}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}

                <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-foreground">Counters</Text>
                      <Text className="text-xs text-muted-foreground">
                        Show furigana for counters.
                      </Text>
                    </View>
                    <Switch
                      value={draftReaderCounterFurigana}
                      onValueChange={setDraftReaderCounterFurigana}
                    />
                  </View>
                </View>

                <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-foreground">Names</Text>
                      <Text className="text-xs text-muted-foreground">
                        Show furigana for names.
                      </Text>
                    </View>
                    <Switch
                      value={draftReaderNameFurigana}
                      onValueChange={setDraftReaderNameFurigana}
                    />
                  </View>
                </View>

                <View className="gap-2">
                  <Pressable
                    onPress={() => setShowAdvancedReadingPatterns((prev) => !prev)}
                    className="px-1 py-1 flex-row items-center gap-1.5"
                  >
                    {showAdvancedReadingPatterns ? (
                      <ChevronDown size={16} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                    <Text className="text-sm font-medium text-muted-foreground">
                      Advanced furigana
                    </Text>
                  </Pressable>
                  <View className="relative">
                    <View
                      pointerEvents="none"
                      className="absolute inset-x-0 top-0 opacity-0 pb-1"
                      onLayout={(event) => {
                        const nextHeight = event.nativeEvent.layout.height;
                        if (nextHeight > 0 && nextHeight !== advancedReadingPatternsHeight) {
                          setAdvancedReadingPatternsHeight(nextHeight);
                        }
                      }}
                    >
                      {hasSourceFurigana && (
                        <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 mb-2">
                          <View className="flex-row items-center justify-between gap-3">
                            <View className="flex-1">
                              <Text className="text-sm font-medium text-foreground">
                                Source furigana
                              </Text>
                              <Text className="text-xs text-muted-foreground">
                                Use furigana already embedded in the book.
                              </Text>
                            </View>
                            <Switch
                              value={draftSourceFuriganaEnabled}
                              onValueChange={setDraftSourceFuriganaEnabled}
                            />
                          </View>
                        </View>
                      )}
                      {readingPatternRules.map(([rule, label]) => (
                        <View
                          key={`${rule}-measure`}
                          className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 gap-2"
                        >
                          <View className="flex-row items-center justify-between gap-3">
                            <Text className="text-sm font-medium text-foreground">{label}</Text>
                            <Text className="text-[11px] text-muted-foreground">
                              {formatSelectedLevels(rule)}
                            </Text>
                          </View>
                          <View className="flex-row flex-wrap gap-1.5">
                            {matchLevelOptions.map(([level, levelLabel]) => (
                              <Pressable
                                key={`${rule}-${level}`}
                                onPress={() =>
                                  setDraftFuriganaRuleLevels((prev) => ({
                                    ...prev,
                                    [rule]: {
                                      ...prev[rule],
                                      [level]: !prev[rule][level],
                                    },
                                  }))
                                }
                                className={`px-3 py-1.5 rounded-full border ${
                                  draftFuriganaRuleLevels[rule][level]
                                    ? "bg-foreground border-foreground"
                                    : "bg-background/40 border-border"
                                }`}
                              >
                                <Text
                                  className={`text-xs font-medium ${
                                    draftFuriganaRuleLevels[rule][level]
                                      ? "text-background"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {levelLabel}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                    <Animated.View
                      style={{
                        height: advancedReadingPatternsAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, advancedReadingPatternsHeight + 16],
                        }),
                        opacity: advancedReadingPatternsAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1],
                        }),
                        overflow: "hidden",
                      }}
                    >
                      <View
                        className="gap-2 pb-3"
                        pointerEvents={showAdvancedReadingPatterns ? "auto" : "none"}
                      >
                        {hasSourceFurigana && (
                          <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                            <View className="flex-row items-center justify-between gap-3">
                              <View className="flex-1">
                                <Text className="text-sm font-medium text-foreground">
                                  Source furigana
                                </Text>
                                <Text className="text-xs text-muted-foreground">
                                  Use furigana already embedded in the book.
                                </Text>
                              </View>
                              <Switch
                                value={draftSourceFuriganaEnabled}
                                onValueChange={setDraftSourceFuriganaEnabled}
                              />
                            </View>
                          </View>
                        )}
                        {readingPatternRules.map(([rule, label]) => (
                          <View
                            key={rule}
                            className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 gap-2"
                          >
                            <View className="flex-row items-center justify-between gap-3">
                              <Text className="text-sm font-medium text-foreground">{label}</Text>
                              <Text className="text-[11px] text-muted-foreground">
                                {formatSelectedLevels(rule)}
                              </Text>
                            </View>
                            <View className="flex-row flex-wrap gap-1.5">
                              {matchLevelOptions.map(([level, levelLabel]) => (
                                <Pressable
                                  key={`${rule}-${level}`}
                                  onPress={() =>
                                    setDraftFuriganaRuleLevels((prev) => ({
                                      ...prev,
                                      [rule]: {
                                        ...prev[rule],
                                        [level]: !prev[rule][level],
                                      },
                                    }))
                                  }
                                  className={`px-3 py-1.5 rounded-full border ${
                                    draftFuriganaRuleLevels[rule][level]
                                      ? "bg-foreground border-foreground"
                                      : "bg-background/40 border-border"
                                  }`}
                                >
                                  <Text
                                    className={`text-xs font-medium ${
                                      draftFuriganaRuleLevels[rule][level]
                                        ? "text-background"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    {levelLabel}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    </Animated.View>
                  </View>
                </View>

                <Separator className="opacity-40" />

                {/* Page animations toggle */}
                <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-foreground">Page animations</Text>
                      <Text className="text-xs text-muted-foreground">
                        Animate page turns in the reader.
                      </Text>
                    </View>
                    <Switch value={pageAnimations} onValueChange={setPageAnimations} />
                  </View>
                </View>
              </ScrollView>
            )}
          </View>

          {/* Highlight toolbar: Copy + Open in (mobile only — web has native context menu) */}
          {Platform.OS !== "web" && copyTooltip && (
            <HighlightToolbar
              tooltip={copyTooltip}
              readerY={readerLayoutY}
              isDark={isDark}
              copied={copied}
              onCopy={handleCopy}
            />
          )}

          {/* Jump slider */}
          {showJumpSlider && modelRef.current && (
            <JumpSlider
              initialPercent={
                modelRef.current.totalChars > 0
                  ? Math.round((scrollPosRef.current / modelRef.current.totalChars) * 100)
                  : 0
              }
              isDark={isDark}
              onJump={async (pct) => {
                setShowJumpSlider(false);
                const model = modelRef.current;
                if (!model) return;
                const charOffset = Math.round((pct / 100) * model.totalChars);
                await reloadAtChar(charOffset);
              }}
              onDismiss={() => setShowJumpSlider(false)}
            />
          )}

          {/* Dictionary popup */}
          <DictionaryPopup
            visible={showPopup}
            loading={lookupLoading}
            errorMessage={lookupError}
            onClose={() => {
              setShowPopup(false);
              setLookupResults([]);
              setLookupLoading(false);
              setLookupError(null);
              setCopyTooltip(null);
              setCopied(false);
              readerRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
              readerRef.current?.focus();
            }}
            results={lookupResults}
          />
        </>
      )}
    </CustomHeaderScreen>
  );
}
