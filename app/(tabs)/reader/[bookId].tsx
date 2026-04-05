import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Linking,
  Platform,
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { CustomHeaderScreen, useWebBackdrop } from "@/components/CustomHeaderScreen";
import { Text } from "@/components/ui/text";
import { DictionaryPopup } from "@/components/DictionaryPopup";
import { ReaderView, type ReaderViewRef } from "@/components/ReaderView";
import {
  ChevronLeft,
  ChevronDown,
  SlidersHorizontal,
  BookText,
  User,
  Download,
  Trash2,
} from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { generateReaderHtml } from "@/lib/reader-html";
import {
  parseAozoraToHtml,
  hasAozoraMarkup,
  plainTextToHtml,
  stripAozoraBoilerplate,
} from "@/lib/aozora-parser";
import {
  type BookFormat,
  type TextModel,
  parseBookContent,
  sliceContent,
  calcCharsPerPage,
} from "@/lib/reader-model";
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
  readerFuriganaLevelsAtom,
  readerPageAnimationsAtom,
  type FuriganaLevel,
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
import { getReaderProgressFlushMode } from "@/lib/reader-progress";
import { getSelectionToolbarPosition } from "@/lib/reader-selection-toolbar";

/** Does this book's raw content contain source furigana? */
function bookHasSourceFurigana(rawContent: string): boolean {
  return /<ruby[\s>]/.test(rawContent) || hasAozoraMarkup(rawContent);
}

/** Should furigana layout be active? Accounts for source furigana + "default" toggle. */
function hasFuriganaActive(
  levels: Record<FuriganaLevel, boolean>,
  bookHasSource: boolean,
): boolean {
  if (bookHasSource && levels.default) return true;
  return Object.entries(levels).some(([k, v]) => k !== "default" && v);
}

/** Strip <ruby> tags keeping only base text (removes <rt> content) */
function stripRubyTags(html: string): string {
  return html.replace(/<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/g, "$1");
}

const TOOLBAR_GAP = 24;
const POPUP_SAFE_ZONE = 380;
const TOOLBAR_SIDE_MARGIN = 8;
const READ_PROGRESS_FLUSH_MS = 15_000;

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
  const [furiganaLevels, setFuriganaLevels] = useAtom(readerFuriganaLevelsAtom);
  const [pageAnimations, setPageAnimations] = useAtom(readerPageAnimationsAtom);

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

  // Streaming prefetch refs — used by handleMessage for pageRendered
  const modelRef = useRef<TextModel | null>(null);
  const sliceCharOffsetRef = useRef(0);
  const fwdLoadedEndRef = useRef(0); // furthest global char loaded into WebView
  const isAozoraRef = useRef(false);
  const backPrefetchingRef = useRef(false);

  // Furigana refs
  const kanjiSetRef = useRef<FuriganaKanjiSet | null>(null);
  const furiganaLevelsRef = useRef(furiganaLevels);
  const hasSourceFuriganaRef = useRef(false);
  const [hasSourceFurigana, setHasSourceFurigana] = useState(false);

  useEffect(() => {
    furiganaLevelsRef.current = furiganaLevels;
  }, [furiganaLevels]);
  useEffect(() => {
    lookupModeRef.current = lookupMode;
  }, [lookupMode]);

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
      const levels = furiganaLevelsRef.current;
      const hasFuri = kanjiSetRef.current != null || hasFuriganaActive(levels, bookHasSource);

      const screen = Dimensions.get("window");
      const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
      const startChar = Math.max(0, charOffset - cpp * 10);
      const totalBudget = charOffset - startChar + cpp * 3;
      const slice = sliceContent(model, startChar, totalBudget);
      const targetLocalChar = charOffset - startChar;

      sliceCharOffsetRef.current = startChar;
      fwdLoadedEndRef.current = Math.min(startChar + totalBudget, model.totalChars);
      backPrefetchingRef.current = false;

      let sliceHtml = isAozora
        ? parseAozoraToHtml(slice.text, { strip: false })
        : plainTextToHtml(slice.text);

      // Strip source ruby if ALL furigana is disabled
      if (isAozora && !hasFuri) {
        sliceHtml = stripRubyTags(sliceHtml);
      }

      if (kanjiSetRef.current) {
        const surfaces = extractSurfacesFromHtml(sliceHtml, kanjiSetRef.current);
        if (surfaces.length > 0) {
          const readings = await resolveFuriganaBatch(surfaces, dictDb);
          const fMap = new Map<string, FuriganaEntry>(
            Object.entries(readings) as [string, FuriganaEntry][],
          );
          sliceHtml = applyFuriganaToHtml(sliceHtml, fMap, kanjiSetRef.current);
        }
        sliceHtml = injectRubySpacers(sliceHtml);
      }

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
    [dictDb, fontSize],
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

      // If content already has <ruby> HTML tags (e.g. from Aozora XHTML), use as-is
      const hasRubyTags = /<ruby[>\s]/.test(b.rawContent);

      if (hasRubyTags) {
        // Pre-formatted HTML — send entire content (no slicing)
        const hasFuri = hasFuriganaActive(furiganaLevels, true);
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
        const hasFuri = hasFuriganaActive(furiganaLevels, isAozora);
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

        let sliceHtml = isAozora
          ? parseAozoraToHtml(slice.text, { strip: false })
          : plainTextToHtml(slice.text);

        // Strip source ruby if ALL furigana is disabled
        if (isAozora && !hasFuri) {
          sliceHtml = stripRubyTags(sliceHtml);
        }

        // Apply JLPT furigana if any non-default levels are enabled
        const hasJlptFuri = Object.entries(furiganaLevels).some(([k, v]) => k !== "default" && v);
        if (hasJlptFuri && dictDb) {
          const kanjiSet = await buildFuriganaKanjiSet(dictDb, furiganaLevels);
          kanjiSetRef.current = kanjiSet;
          const surfaces = extractSurfacesFromHtml(sliceHtml, kanjiSet);
          if (surfaces.length > 0) {
            const readings = await resolveFuriganaBatch(surfaces, dictDb);
            const fMap = new Map<string, FuriganaEntry>(
              Object.entries(readings) as [string, FuriganaEntry][],
            );
            sliceHtml = applyFuriganaToHtml(sliceHtml, fMap, kanjiSet);
          }
          sliceHtml = injectRubySpacers(sliceHtml);
        }

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
  }, [userDb, bookId, isDark]);

  // Re-apply furigana when levels change
  useEffect(() => {
    if (!book || !dictDb || !modelRef.current || html === null) return;
    const hasJlptFuri = Object.entries(furiganaLevels).some(([k, v]) => k !== "default" && v);

    (async () => {
      // Build kanji set (or clear it) — only for JLPT levels, not "default"
      if (hasJlptFuri) {
        const kanjiSet = await buildFuriganaKanjiSet(dictDb, furiganaLevels);
        kanjiSetRef.current = kanjiSet;
      } else {
        kanjiSetRef.current = null;
      }

      const charOffset = scrollPosRef.current || 0;
      await reloadAtChar(charOffset);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furiganaLevels, dictDb]);

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
              hasFuriganaActive(furiganaLevelsRef.current, hasSourceFuriganaRef.current);
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
            const nextSlice = sliceContent(model, nextStart, cpp * 3);
            const newEnd = Math.min(nextStart + cpp * 3, model.totalChars);
            let nextHtml = isAozoraRef.current
              ? parseAozoraToHtml(nextSlice.text, { strip: false })
              : plainTextToHtml(nextSlice.text);
            // Strip source ruby if ALL furigana is disabled
            if (isAozoraRef.current && !hasFuri) {
              nextHtml = stripRubyTags(nextHtml);
            }
            if (kanjiSetRef.current && dictDb) {
              const surfaces = extractSurfacesFromHtml(nextHtml, kanjiSetRef.current);
              if (surfaces.length > 0) {
                const readings = await resolveFuriganaBatch(surfaces, dictDb);
                const fMap = new Map<string, FuriganaEntry>(
                  Object.entries(readings) as [string, FuriganaEntry][],
                );
                nextHtml = applyFuriganaToHtml(nextHtml, fMap, kanjiSetRef.current);
              }
              nextHtml = injectRubySpacers(nextHtml);
            }
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
              hasFuriganaActive(furiganaLevelsRef.current, hasSourceFuriganaRef.current);
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, hasFuri);
            const backStart = Math.max(0, sliceCharOffsetRef.current - cpp * 10);
            const backChars = sliceCharOffsetRef.current - backStart;
            if (backChars > 0) {
              const backSlice = sliceContent(model, backStart, backChars);
              let backHtml = isAozoraRef.current
                ? parseAozoraToHtml(backSlice.text, { strip: false })
                : plainTextToHtml(backSlice.text);
              // Strip source ruby if ALL furigana is disabled
              if (isAozoraRef.current && !hasFuri) {
                backHtml = stripRubyTags(backHtml);
              }
              if (kanjiSetRef.current && dictDb) {
                const surfaces = extractSurfacesFromHtml(backHtml, kanjiSetRef.current);
                if (surfaces.length > 0) {
                  const readings = await resolveFuriganaBatch(surfaces, dictDb);
                  const fMap = new Map<string, FuriganaEntry>(
                    Object.entries(readings) as [string, FuriganaEntry][],
                  );
                  backHtml = applyFuriganaToHtml(backHtml, fMap, kanjiSetRef.current);
                }
                backHtml = injectRubySpacers(backHtml);
              }
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
        hasFuriganaActive(furiganaLevelsRef.current, hasSourceFuriganaRef.current);
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
          <Pressable onPress={() => setShowSettings(!showSettings)} className="p-2">
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
              <View
                className="absolute left-0 right-0 top-0 px-4 py-3 border-b border-border bg-background gap-3"
                style={{ zIndex: 10 }}
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

                {/* Furigana level toggles */}
                <View>
                  <Text className="text-xs text-muted-foreground text-center mb-2">Furigana</Text>
                  <View className="flex-row flex-wrap justify-center gap-1.5">
                    {(
                      [
                        ...(hasSourceFurigana
                          ? ([["default", "Default"]] as [FuriganaLevel, string][])
                          : []),
                        ["n5", "N5"],
                        ["n4", "N4"],
                        ["n3", "N3"],
                        ["n2", "N2"],
                        ["n1", "N1"],
                        ["nonJouyou", "Other"],
                        ["all", "All"],
                      ] as [FuriganaLevel, string][]
                    ).map(([key, label]) => (
                      <Pressable
                        key={key}
                        onPress={() =>
                          setFuriganaLevels((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className={`px-3 py-1.5 rounded-full border ${
                          furiganaLevels[key]
                            ? "bg-foreground border-foreground"
                            : "bg-transparent border-border"
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            furiganaLevels[key] ? "text-background" : "text-muted-foreground"
                          }`}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Page animations toggle */}
                <View className="flex-row items-center justify-center gap-2">
                  <Pressable
                    onPress={() => setPageAnimations(!pageAnimations)}
                    className={`px-3 py-1.5 rounded-full border ${
                      pageAnimations
                        ? "bg-foreground border-foreground"
                        : "bg-transparent border-border"
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        pageAnimations ? "text-background" : "text-muted-foreground"
                      }`}
                    >
                      Page animations
                    </Text>
                  </Pressable>
                </View>
              </View>
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
