import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Animated,
  Pressable,
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
import { useColorScheme } from "nativewind";
import { useAtom } from "jotai";
import { CustomHeaderScreen, useWebBackdrop } from "@/components/CustomHeaderScreen";
import { DictionaryPopup } from "@/components/DictionaryPopup";
import { PhasedLoadingOverlay } from "@/components/PhasedLoadingOverlay";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { useSync } from "@/db/sync-provider";
import { useUserDb } from "@/db/user-provider";
import { useAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  BookText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  SlidersHorizontal,
  Trash2,
  User,
} from "@/lib/icons";
import { useSafeGoBack } from "@/lib/navigation";
import {
  requestReaderSentenceExplanation,
  type ReaderSentenceExplanationState,
} from "@/lib/reader-explain";
import { useBookmarkStore } from "@/stores/bookmarks";
import {
  readerBookmarkHighlightsAtom,
  readerCounterFuriganaAtom,
  readerFuriganaRuleLevelsAtom,
  readerNameFuriganaAtom,
  readerPageAnimationsAtom,
  readerSourceFuriganaAtom,
  type FuriganaMatchLevel,
  type ReaderFuriganaRule,
} from "@/stores/settings";
import {
  type JapaneseReaderSettingsDraft,
  type ReaderSelectionTooltip,
  type ReaderBookmarkMembership,
  getSelectionToolbarPosition,
  useJapaneseReader,
} from "@jiten/japanese-reader";
import { ReaderView } from "@jiten/japanese-reader/reader-view";
import { createJitenReaderBookSource } from "./book-source";

const TOOLBAR_GAP = 24;
const TOOLBAR_DRAWER_GAP = 8;
const TOOLBAR_SIDE_MARGIN = 8;

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
  {
    label: "Google Translate",
    url: () => "googletranslate://",
    store: "https://apps.apple.com/app/google-translate/id414706506",
  },
];

function buildExplainPrompt({
  selectedText,
  bookTitle,
}: {
  selectedText: string;
  bookTitle?: string | null;
}) {
  return [
    bookTitle ? `Context: this Japanese text is from the book "${bookTitle}".` : null,
    "Explain this Japanese passage in English.",
    "",
    selectedText,
  ]
    .filter(Boolean)
    .join("\n");
}

function HighlightToolbar({
  tooltip,
  readerHeight,
  bottomBoundaryY,
  isDark,
  copied,
  onCopy,
  onCopyText,
  onExplain,
  bookTitle,
}: {
  tooltip: ReaderSelectionTooltip;
  readerHeight: number;
  bottomBoundaryY: number;
  isDark: boolean;
  copied: boolean;
  onCopy: () => void;
  onCopyText: (text: string) => void;
  onExplain: (text: string) => void;
  bookTitle?: string | null;
}) {
  const [openInExpanded, setOpenInExpanded] = useState(false);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const screen = Dimensions.get("window");
  const extraRows = openInExpanded ? EXTERNAL_DICTS.length + 3 : 0;
  const toolbarH = 32 + extraRows * 34 + (extraRows > 0 ? 18 : 0);
  const estimatedToolbarWidth = openInExpanded ? 260 : 206;
  const { top, left } = getSelectionToolbarPosition({
    anchorX: tooltip.x,
    anchorY: tooltip.y,
    readerTop: 0,
    screenWidth: screen.width,
    screenHeight: readerHeight,
    toolbarWidth: toolbarWidth || estimatedToolbarWidth,
    toolbarHeight: toolbarH,
    toolbarGap: TOOLBAR_GAP,
    bottomBoundaryY,
    bottomSafeGap: TOOLBAR_DRAWER_GAP,
    sideMargin: TOOLBAR_SIDE_MARGIN,
  });
  const bg = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
  const fg = isDark ? "#000" : "#fff";

  function handleToolbarLayout(e: LayoutChangeEvent) {
    const nextWidth = Math.round(e.nativeEvent.layout.width);
    setToolbarWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  }

  async function handleExplainOpen(app: "claude" | "chatgpt") {
    const prompt = buildExplainPrompt({ selectedText: tooltip.text, bookTitle });
    onCopyText(prompt);
    if (app === "claude") {
      await Linking.openURL("claude://").catch(() =>
        Linking.openURL("https://apps.apple.com/app/claude-by-anthropic/id6473753684"),
      );
      return;
    }
    await Linking.openURL("chatgpt://").catch(() =>
      Linking.openURL("https://apps.apple.com/app/chatgpt/id6448311069"),
    );
  }

  const directOpenActions = EXTERNAL_DICTS.map((d) => ({
    key: d.label,
    label: d.label,
    onPress: () => {
      const encoded = encodeURIComponent(tooltip.text);
      Linking.openURL(d.url(encoded)).catch(() => {
        Linking.openURL(d.store);
      });
    },
  }));

  const copyOpenActions = [
    {
      key: "claude-copy-open",
      label: "Claude",
      onPress: () => {
        void handleExplainOpen("claude");
      },
    },
    {
      key: "chatgpt-copy-open",
      label: "ChatGPT",
      onPress: () => {
        void handleExplainOpen("chatgpt");
      },
    },
  ];

  return (
    <View
      style={{
        position: "absolute",
        zIndex: 50,
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Pressable onPress={onCopy} style={{ paddingHorizontal: 10, paddingVertical: 2 }}>
            <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>
              {copied ? "Copied!" : "Copy"}
            </Text>
          </Pressable>
          <View style={{ width: 1, height: 16, backgroundColor: fg, opacity: 0.3 }} />
          <Pressable
            onPress={() => onExplain(tooltip.text)}
            style={{ paddingHorizontal: 10, paddingVertical: 2 }}
          >
            <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>Explain</Text>
          </Pressable>
          {Platform.OS === "ios" && (
            <>
              <View style={{ width: 1, height: 16, backgroundColor: fg, opacity: 0.3 }} />
              <Pressable
                onPress={() => {
                  setOpenInExpanded(!openInExpanded);
                }}
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
        {openInExpanded && (
          <View
            style={{
              marginTop: 6,
              paddingHorizontal: 4,
              gap: 6,
            }}
          >
            {directOpenActions.map((action) => (
              <Pressable
                key={action.key}
                onPress={action.onPress}
                style={{
                  backgroundColor: fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 10,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: bg, fontSize: 11, fontWeight: "600" }}>{action.label}</Text>
              </Pressable>
            ))}
            <View style={{ marginTop: 2 }}>
              <Text style={{ color: fg, fontSize: 10, fontWeight: "700", opacity: 0.7 }}>
                Copy + Open
              </Text>
            </View>
            {copyOpenActions.map((action) => (
              <Pressable
                key={action.key}
                onPress={action.onPress}
                style={{
                  backgroundColor: fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 10,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: bg, fontSize: 11, fontWeight: "600" }}>{action.label}</Text>
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

  const pctFromTouch = (pageX: number) => {
    const x = pageX - trackXRef.current;
    const clamped = Math.max(0, Math.min(x, trackWidthRef.current));
    return trackWidthRef.current > 0
      ? Math.round(((trackWidthRef.current - clamped) / trackWidthRef.current) * 100)
      : 0;
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    setPercent(pctFromTouch(e.nativeEvent.pageX));
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    setPercent(pctFromTouch(e.nativeEvent.pageX));
  };

  const handleTouchEnd = (e: GestureResponderEvent) => {
    const pct = pctFromTouch(e.nativeEvent.pageX);
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
          style={{ height: 36, justifyContent: "center" }}
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
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const userDb = useUserDb();
  const { dictDb, extendedDb } = useDatabase();
  const { markDirty, triggerSync } = useSync();
  const { getToken } = useAuth();
  const { webBgStyle } = useWebBackdrop(15);
  const [readerHeight, setReaderHeight] = useState(Dimensions.get("window").height);
  const [lookupPopupTop, setLookupPopupTop] = useState(Dimensions.get("window").height);

  const [sourceFuriganaEnabled, setSourceFuriganaEnabled] = useAtom(readerSourceFuriganaAtom);
  const [readerBookmarkHighlights, setReaderBookmarkHighlights] = useAtom(
    readerBookmarkHighlightsAtom,
  );
  const [readerCounterFurigana, setReaderCounterFurigana] = useAtom(readerCounterFuriganaAtom);
  const [readerNameFurigana, setReaderNameFurigana] = useAtom(readerNameFuriganaAtom);
  const [furiganaRuleLevels, setFuriganaRuleLevels] = useAtom(readerFuriganaRuleLevelsAtom);
  const [pageAnimations, setPageAnimations] = useAtom(readerPageAnimationsAtom);
  const bookmarkedIds = useBookmarkStore((s) => s.bookmarkedIds);

  const bookmarkMembership = useMemo<ReaderBookmarkMembership>(() => {
    const entryIds = new Set(
      [...bookmarkedIds]
        .filter((key) => key.startsWith("e:"))
        .map((key) => Number(key.slice(2)))
        .filter((id) => Number.isFinite(id)),
    );
    const version = [...entryIds].sort((a, b) => a - b).join(",");
    return {
      version,
      hasEntryId: (entryId) => entryIds.has(entryId),
    };
  }, [bookmarkedIds]);

  const [showSettings, setShowSettings] = useState(false);
  const [showAdvancedReadingPatterns, setShowAdvancedReadingPatterns] = useState(false);
  const [advancedReadingPatternsHeight, setAdvancedReadingPatternsHeight] = useState(0);
  const [advancedReadingPatternsAnim] = useState(() => new Animated.Value(0));
  const [sentenceExplanation, setSentenceExplanation] = useState<ReaderSentenceExplanationState>({
    status: "idle",
  });
  const explanationRequestIdRef = useRef(0);
  const [draftSettings, setDraftSettings] = useState<JapaneseReaderSettingsDraft>({
    fontSize: 22,
    pageAnimations,
    sourceFuriganaEnabled,
    readerCounterFurigana,
    readerNameFurigana,
    readerBookmarkHighlights,
    furiganaRuleLevels,
  });

  useEffect(() => {
    Animated.timing(advancedReadingPatternsAnim, {
      toValue: showAdvancedReadingPatterns ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [advancedReadingPatternsAnim, showAdvancedReadingPatterns]);

  const bookSource = useMemo(
    () =>
      userDb
        ? createJitenReaderBookSource(userDb, markDirty)
        : {
            loadBook: async () => null,
            saveProgress: async () => {},
            savePreferences: async () => {},
            markOpened: async () => {},
          },
    [markDirty, userDb],
  );

  const readerBackend = useMemo(
    () => ({
      dictDb,
      extendedDb,
      bookmarks: bookmarkMembership,
    }),
    [bookmarkMembership, dictDb, extendedDb],
  );

  const readerSettings = useMemo(
    () => ({
      pageAnimations,
      sourceFuriganaEnabled,
      readerCounterFurigana,
      readerNameFurigana,
      readerBookmarkHighlights,
      furiganaRuleLevels,
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

  const readerSettingsActions = useMemo(
    () => ({
      setPageAnimations,
      setSourceFuriganaEnabled,
      setReaderCounterFurigana,
      setReaderNameFurigana,
      setReaderBookmarkHighlights,
      setFuriganaRuleLevels,
    }),
    [
      setFuriganaRuleLevels,
      setPageAnimations,
      setReaderBookmarkHighlights,
      setReaderCounterFurigana,
      setReaderNameFurigana,
      setSourceFuriganaEnabled,
    ],
  );

  const reader = useJapaneseReader({
    bookId: bookId ?? "",
    bookSource,
    backend: readerBackend,
    settings: readerSettings,
    settingsActions: readerSettingsActions,
    isDark,
  });

  const {
    book,
    missingBook,
    lookupMode,
    cycleLookupMode,
    readerViewRef,
    readerViewProps,
    loadingState,
    lookupResults,
    lookupLoading,
    lookupError,
    showLookupPopup,
    closeLookupPopup,
    copyTooltip,
    copied,
    handleCopy,
    showJumpSlider,
    dismissJumpSlider,
    jumpPercent,
    jumpToPercent,
    createSettingsDraft,
    applySettingsDraft,
    patchBook,
    hasSourceFurigana,
  } = reader;

  useEffect(() => {
    if (missingBook) goBack();
  }, [goBack, missingBook]);

  const openSettings = useCallback(() => {
    setDraftSettings(createSettingsDraft());
    setShowSettings(true);
  }, [createSettingsDraft]);

  const saveSettings = useCallback(() => {
    setShowSettings(false);
    applySettingsDraft(draftSettings);
  }, [applySettingsDraft, draftSettings]);

  const cancelSettings = useCallback(() => {
    setShowSettings(false);
    setDraftSettings(createSettingsDraft());
  }, [createSettingsDraft]);

  const toggleSettings = useCallback(() => {
    if (showSettings) {
      saveSettings();
      return;
    }
    openSettings();
  }, [openSettings, saveSettings, showSettings]);

  const matchLevelOptions: [FuriganaMatchLevel, string][] = [
    ["n5", "N5"],
    ["n4", "N4"],
    ["n3", "N3"],
    ["n2", "N2"],
    ["n1", "N1"],
    ["nonJouyou", "Other"],
  ];

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

  const formatSelectedLevels = useCallback(
    (rule: ReaderFuriganaRule) => {
      const labels = matchLevelOptions
        .filter(([level]) => draftSettings.furiganaRuleLevels[rule][level])
        .map(([, label]) => label);
      return labels.length > 0 ? labels.join(" ") : "Off";
    },
    [draftSettings.furiganaRuleLevels],
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
    patchBook({ saved: newSaved });
    triggerSync();
  }, [book, patchBook, triggerSync, userDb]);

  const handleCopyText = useCallback(
    (text: string) => {
      readerViewRef.current?.postMessage(JSON.stringify({ type: "copyToClipboard", text }));
    },
    [readerViewRef],
  );

  const currentBookTitle = book?.title ?? null;

  async function handleExplainText(text: string) {
    const selectedText = text.trim();
    if (!selectedText) return;
    const requestId = explanationRequestIdRef.current + 1;
    explanationRequestIdRef.current = requestId;
    setSentenceExplanation({ status: "loading", selectedText });
    try {
      const result = await requestReaderSentenceExplanation({
        apiBaseUrl: env.API_BASE_URL,
        getToken,
        input: {
          selectedText,
          bookTitle: currentBookTitle,
        },
      });
      if (explanationRequestIdRef.current !== requestId) return;
      setSentenceExplanation({ status: "ready", selectedText, result });
    } catch (err) {
      if (explanationRequestIdRef.current !== requestId) return;
      const message = err instanceof Error ? err.message : "Could not explain selection.";
      setSentenceExplanation({ status: "error", selectedText, message });
    }
  }

  const handleCloseLookupPopup = useCallback(() => {
    explanationRequestIdRef.current += 1;
    setSentenceExplanation({ status: "idle" });
    closeLookupPopup();
  }, [closeLookupPopup]);

  const handleLookupPopupTopChange = useCallback((top: number) => {
    if (top <= 0) return;
    setLookupPopupTop((prev) => (Math.abs(prev - top) < 1 ? prev : top));
  }, []);

  const toolbarBottomBoundaryY = showLookupPopup ? lookupPopupTop : readerHeight;

  const visibleSentenceExplanation =
    sentenceExplanation.status !== "idle" &&
    sentenceExplanation.selectedText !== copyTooltip?.text.trim()
      ? ({ status: "idle" } as const)
      : sentenceExplanation;

  return (
    <CustomHeaderScreen webTop={15}>
      <View
        className="flex-row items-center px-2 pb-2 border-b border-border bg-background"
        style={webBgStyle}
      >
        {showSettings ? (
          <>
            <Pressable onPress={cancelSettings} className="px-3 py-2">
              <Text className="text-sm font-semibold text-primary">Cancel</Text>
            </Pressable>
            <Text
              className="flex-1 text-base font-medium text-foreground text-center"
              numberOfLines={1}
            >
              Reader Settings
            </Text>
            <Pressable onPress={saveSettings} className="px-3 py-2">
              <Text className="text-sm font-semibold text-primary">Save</Text>
            </Pressable>
          </>
        ) : (
          <>
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
          </>
        )}
      </View>

      <View className="flex-1" style={{ backgroundColor: isDark ? "#18181b" : "#fafaf9" }}>
        {readerViewProps ? (
          <>
            <View
              style={{ flex: 1 }}
              onLayout={(e) => {
                const nextHeight = Math.ceil(e.nativeEvent.layout.height);
                if (nextHeight > 0) setReaderHeight(nextHeight);
              }}
            >
              <ReaderView ref={readerViewRef} {...readerViewProps} />
              {showSettings && (
                <ScrollView
                  className="absolute left-0 right-0 top-0 px-4 py-3 border-b border-border bg-background gap-3"
                  style={{ zIndex: 1000, elevation: 20, maxHeight: "100%" }}
                  contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
                  showsVerticalScrollIndicator={false}
                >
                  <View className="flex-row items-center justify-center gap-4">
                    <Pressable
                      onPress={() =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          fontSize: Math.max(14, prev.fontSize - 1),
                        }))
                      }
                      disabled={draftSettings.fontSize <= 14}
                      className={`h-10 w-10 items-center justify-center rounded-lg border border-border ${draftSettings.fontSize <= 14 ? "opacity-30" : ""}`}
                    >
                      <Text className="text-lg text-foreground">A-</Text>
                    </Pressable>
                    <Text className="text-base text-foreground w-8 text-center">
                      {draftSettings.fontSize}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          fontSize: Math.min(32, prev.fontSize + 1),
                        }))
                      }
                      disabled={draftSettings.fontSize >= 32}
                      className={`h-10 w-10 items-center justify-center rounded-lg border border-border ${draftSettings.fontSize >= 32 ? "opacity-30" : ""}`}
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
                                  setDraftSettings((prev) => ({
                                    ...prev,
                                    furiganaRuleLevels: {
                                      ...prev.furiganaRuleLevels,
                                      [rule]: {
                                        ...prev.furiganaRuleLevels[rule],
                                        [level]: !prev.furiganaRuleLevels[rule][level],
                                      },
                                    },
                                  }))
                                }
                                className={`px-3 py-1.5 rounded-full border ${
                                  draftSettings.furiganaRuleLevels[rule][level]
                                    ? "bg-foreground border-foreground"
                                    : "bg-background/40 border-border"
                                }`}
                              >
                                <Text
                                  className={`text-xs font-medium ${
                                    draftSettings.furiganaRuleLevels[rule][level]
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
                        value={draftSettings.readerCounterFurigana}
                        onValueChange={(value) =>
                          setDraftSettings((prev) => ({ ...prev, readerCounterFurigana: value }))
                        }
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
                        value={draftSettings.readerNameFurigana}
                        onValueChange={(value) =>
                          setDraftSettings((prev) => ({ ...prev, readerNameFurigana: value }))
                        }
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
                                value={draftSettings.sourceFuriganaEnabled}
                                onValueChange={(value) =>
                                  setDraftSettings((prev) => ({
                                    ...prev,
                                    sourceFuriganaEnabled: value,
                                  }))
                                }
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
                                    setDraftSettings((prev) => ({
                                      ...prev,
                                      furiganaRuleLevels: {
                                        ...prev.furiganaRuleLevels,
                                        [rule]: {
                                          ...prev.furiganaRuleLevels[rule],
                                          [level]: !prev.furiganaRuleLevels[rule][level],
                                        },
                                      },
                                    }))
                                  }
                                  className={`px-3 py-1.5 rounded-full border ${
                                    draftSettings.furiganaRuleLevels[rule][level]
                                      ? "bg-foreground border-foreground"
                                      : "bg-background/40 border-border"
                                  }`}
                                >
                                  <Text
                                    className={`text-xs font-medium ${
                                      draftSettings.furiganaRuleLevels[rule][level]
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
                                  value={draftSettings.sourceFuriganaEnabled}
                                  onValueChange={(value) =>
                                    setDraftSettings((prev) => ({
                                      ...prev,
                                      sourceFuriganaEnabled: value,
                                    }))
                                  }
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
                                      setDraftSettings((prev) => ({
                                        ...prev,
                                        furiganaRuleLevels: {
                                          ...prev.furiganaRuleLevels,
                                          [rule]: {
                                            ...prev.furiganaRuleLevels[rule],
                                            [level]: !prev.furiganaRuleLevels[rule][level],
                                          },
                                        },
                                      }))
                                    }
                                    className={`px-3 py-1.5 rounded-full border ${
                                      draftSettings.furiganaRuleLevels[rule][level]
                                        ? "bg-foreground border-foreground"
                                        : "bg-background/40 border-border"
                                    }`}
                                  >
                                    <Text
                                      className={`text-xs font-medium ${
                                        draftSettings.furiganaRuleLevels[rule][level]
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

                  <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-foreground">
                          Bookmarked words
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          Highlight bookmarked words in the reader.
                        </Text>
                      </View>
                      <Switch
                        value={draftSettings.readerBookmarkHighlights}
                        onValueChange={(value) =>
                          setDraftSettings((prev) => ({ ...prev, readerBookmarkHighlights: value }))
                        }
                      />
                    </View>
                  </View>

                  <View className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-foreground">Page animations</Text>
                        <Text className="text-xs text-muted-foreground">
                          Animate page turns in the reader.
                        </Text>
                      </View>
                      <Switch
                        value={draftSettings.pageAnimations}
                        onValueChange={(value) =>
                          setDraftSettings((prev) => ({ ...prev, pageAnimations: value }))
                        }
                      />
                    </View>
                  </View>
                </ScrollView>
              )}
            </View>

            {copyTooltip && (
              <HighlightToolbar
                tooltip={copyTooltip}
                readerHeight={readerHeight}
                bottomBoundaryY={toolbarBottomBoundaryY}
                isDark={isDark}
                copied={copied}
                onCopy={handleCopy}
                onCopyText={handleCopyText}
                onExplain={handleExplainText}
                bookTitle={book?.title}
              />
            )}

            {showJumpSlider && (
              <JumpSlider
                initialPercent={jumpPercent}
                isDark={isDark}
                onJump={jumpToPercent}
                onDismiss={dismissJumpSlider}
              />
            )}

            <DictionaryPopup
              visible={showLookupPopup}
              loading={lookupLoading}
              errorMessage={lookupError}
              explanation={visibleSentenceExplanation}
              onClose={handleCloseLookupPopup}
              onPanelTopChange={handleLookupPopupTopChange}
              results={lookupResults}
            />
          </>
        ) : null}

        <PhasedLoadingOverlay
          key={`reader-load-${loadingState.runId}`}
          visible={loadingState.visible}
          isDark={isDark}
          title={loadingState.title}
          detail={loadingState.detail}
          currentStep={loadingState.currentStep}
          totalSteps={loadingState.totalSteps}
          stepDurationMs={loadingState.stepDurationMs}
        />
      </View>
    </CustomHeaderScreen>
  );
}
