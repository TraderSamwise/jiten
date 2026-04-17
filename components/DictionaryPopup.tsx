import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, View, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { EntrySummary } from "@/components/EntrySummary";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark, ChevronLeft, ChevronRight, X } from "@/lib/icons";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmark } from "@/hooks/useQuickBookmark";
import type { LookupResult } from "@/lib/smart-lookup";
import type { NameEntry } from "@/db/types";

const NAME_TYPE_LABELS: Record<string, string> = {
  surname: "Surname",
  given: "Given name",
  fem: "Female name",
  masc: "Male name",
  place: "Place",
  station: "Station",
  organization: "Organization",
  company: "Company",
  product: "Product",
  person: "Person",
  unclass: "Name",
};

interface DictionaryPopupProps {
  visible: boolean;
  onClose: () => void;
  results: LookupResult[];
  loading?: boolean;
  errorMessage?: string | null;
}

const SLIDE_DURATION = 250;
const SEGMENT_SWIPE_DISTANCE = 28;
const SEGMENT_SWIPE_THRESHOLD = 24;
const SEGMENT_SWIPE_VELOCITY = 500;
const PANEL_MIN_HEIGHT = 220;
const PANEL_MAX_HEIGHT = 320;

function lookupKindLabel(kind?: LookupResult["lookupKind"]): string | null {
  if (kind === "word") return "Word";
  if (kind === "name") return "Name";
  return null;
}

function formatDeinflectReasons(reasons: string[]): string {
  const compact: string[] = [];
  for (const reason of reasons) {
    if (!compact.includes(reason)) compact.push(reason);
  }
  return compact.join(" -> ");
}

function LookupKindSwitch({
  variants,
  selectedIdx,
  onSelect,
}: {
  variants: LookupResult[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  if (variants.length === 0) return null;

  if (variants.length === 1) {
    const label = lookupKindLabel(variants[0].lookupKind);
    if (!label) return null;
    return (
      <View className="rounded-full border border-border bg-muted px-3 py-1">
        <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
      </View>
    );
  }

  return (
    <View className="flex-row rounded-full border border-border bg-muted p-0.5">
      {variants.map((variant, i) => (
        <Pressable
          key={`${variant.lookupKind ?? "lookup"}-${i}`}
          onPress={() => onSelect(i)}
          className={`rounded-full px-3 py-1 ${i === selectedIdx ? "bg-background" : ""}`}
        >
          <Text
            className={`text-xs font-medium ${
              i === selectedIdx ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {lookupKindLabel(variant.lookupKind) ?? "Result"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function DictionaryPopup({
  visible,
  onClose,
  results,
  loading,
  errorMessage,
}: DictionaryPopupProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const windowHeight = Dimensions.get("window").height;
  const [selectedWordIdx, setSelectedWordIdx] = useState(0);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [entryIdx, setEntryIdx] = useState(0);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<
    { top: number; right: number } | undefined
  >();
  const bookmarkRef = useRef<View>(null);
  const [mounted, setMounted] = useState(false);
  const transitionDirectionRef = useRef<1 | -1>(1);
  const isSegmentTransitioningRef = useRef(false);

  const translateY = useSharedValue(400);
  const contentTranslateX = useSharedValue(0);
  const contentOpacity = useSharedValue(1);

  useEffect(() => {
    setSelectedWordIdx(0);
    setSelectedVariantIdx(0);
    setEntryIdx(0);
  }, [results]);

  useEffect(() => {
    setSelectedVariantIdx(0);
    setEntryIdx(0);
  }, [selectedWordIdx]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = 400;
      translateY.value = withTiming(0, { duration: SLIDE_DURATION });
    } else if (mounted) {
      // Instantly unmount — no blocking exit animation
      setMounted(false);
    }
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: contentTranslateX.value }],
  }));
  const panelContentHeight = Math.min(
    PANEL_MAX_HEIGHT,
    Math.max(PANEL_MIN_HEIGHT, Math.round(windowHeight * 0.34)),
  );

  const selectedTopLevelResult =
    results.length > 0 ? results[Math.min(selectedWordIdx, results.length - 1)] : null;
  const variantResults = selectedTopLevelResult?.alternateResults ?? [];
  const wordResult =
    selectedTopLevelResult && variantResults.length > 0
      ? variantResults[Math.min(selectedVariantIdx, variantResults.length - 1)]
      : selectedTopLevelResult;
  const currentEntry =
    wordResult && wordResult.entries.length > 0
      ? wordResult.entries[Math.min(entryIdx, wordResult.entries.length - 1)]
      : null;
  const safeEntryIdx = wordResult ? Math.min(entryIdx, wordResult.entries.length - 1) : 0;
  const total = wordResult ? wordResult.entries.length : 0;

  const isBookmarked = useBookmarkStore((s) =>
    currentEntry ? s.bookmarkedIds.has(`e:${currentEntry.id}`) : false,
  );

  const {
    handlePress: quickBookmarkPress,
    handleLongPress,
    popoverVisible,
    dismissPopover,
    onListToggled,
  } = useQuickBookmark(currentEntry?.id ?? 0, isBookmarked);

  const hasResults =
    results.length > 0 &&
    results.some((r) => r.entries.length > 0 || (r.nameMatches && r.nameMatches.length > 0));
  const isNameResult =
    wordResult?.nameMatches && wordResult.nameMatches.length > 0 && !currentEntry;
  const lookupKindVariants =
    variantResults.length > 0 ? variantResults : wordResult ? [wordResult] : [];

  const finishSegmentTransition = useCallback(() => {
    isSegmentTransitioningRef.current = false;
  }, []);

  const commitSelectedWordIdx = useCallback(
    (nextIdx: number) => {
      setSelectedWordIdx(nextIdx);
      setSelectedVariantIdx(0);
      setEntryIdx(0);
      contentTranslateX.value = transitionDirectionRef.current * SEGMENT_SWIPE_DISTANCE;
      contentOpacity.value = 0.7;
      contentTranslateX.value = withTiming(0, { duration: 180 });
      contentOpacity.value = withTiming(1, { duration: 180 }, (finished) => {
        if (finished) {
          runOnJS(finishSegmentTransition)();
        }
      });
    },
    [finishSegmentTransition],
  );

  const selectWordIndex = useCallback(
    (nextIdx: number, direction: 1 | -1) => {
      if (nextIdx < 0 || nextIdx >= results.length) return;
      if (nextIdx === selectedWordIdx || isSegmentTransitioningRef.current) return;
      isSegmentTransitioningRef.current = true;
      transitionDirectionRef.current = direction;
      contentTranslateX.value = withTiming(
        -direction * SEGMENT_SWIPE_DISTANCE,
        { duration: 120 },
        (finished) => {
          if (finished) {
            runOnJS(commitSelectedWordIdx)(nextIdx);
          } else {
            runOnJS(finishSegmentTransition)();
          }
        },
      );
      contentOpacity.value = withTiming(0.7, { duration: 120 });
    },
    [results.length, selectedWordIdx, commitSelectedWordIdx, finishSegmentTransition],
  );

  const swipeGesture = Gesture.Pan()
    .enabled(results.length > 1)
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16])
    .onEnd((event) => {
      const absX = Math.abs(event.translationX);
      const absVelocityX = Math.abs(event.velocityX);
      if (absX < SEGMENT_SWIPE_THRESHOLD && absVelocityX < SEGMENT_SWIPE_VELOCITY) return;
      if (Math.abs(event.translationX) < Math.abs(event.translationY)) return;
      if (event.translationX < 0) {
        runOnJS(selectWordIndex)(selectedWordIdx + 1, 1);
      } else {
        runOnJS(selectWordIndex)(selectedWordIdx - 1, -1);
      }
    });

  if (!mounted) return null;

  function renderContent() {
    // Loading state
    if (loading && !hasResults) {
      return (
        <View className="items-center py-8">
          <ActivityIndicator size="large" />
        </View>
      );
    }

    // Error state
    if (errorMessage) {
      return <Text className="text-center text-muted-foreground py-8">{errorMessage}</Text>;
    }

    // No results
    if (!hasResults) {
      return <Text className="text-center text-muted-foreground py-8">No results found</Text>;
    }

    return (
      <>
        {/* Header row: pills/matched text (flex) + controls (fixed) */}
        <View className="flex-row items-center mb-3 gap-2">
          {/* Left side: pills or matched text — fills available space */}
          <View className="flex-1" style={{ minWidth: 0 }}>
            {results.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
                style={{ flexGrow: 0 }}
              >
                {results.map((r, i) => (
                  <Pressable
                    key={`${r.lookupKind ?? "lookup"}-${r.matchedText}-${i}`}
                    onPress={() => {
                      selectWordIndex(i, i > selectedWordIdx ? 1 : -1);
                    }}
                    className={`px-3 py-1.5 rounded-full border ${
                      i === Math.min(selectedWordIdx, results.length - 1)
                        ? "bg-primary/20 border-primary/40"
                        : "border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        i === Math.min(selectedWordIdx, results.length - 1)
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {r.matchedText}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View className="flex-row items-center gap-2">
                <Text className="text-xs text-muted-foreground">{wordResult!.matchedText}</Text>
              </View>
            )}
          </View>

          {/* Right side: fixed controls */}
          <View className="flex-row items-center gap-2">
            {!isNameResult && total > 1 && (
              <View className="flex-row items-center gap-1">
                <Pressable
                  onPress={() => setEntryIdx(Math.max(0, safeEntryIdx - 1))}
                  disabled={safeEntryIdx === 0}
                  className="p-1"
                >
                  <ChevronLeft
                    size={18}
                    className={safeEntryIdx === 0 ? "text-muted" : "text-foreground"}
                  />
                </Pressable>
                <Text className="text-sm text-muted-foreground">
                  {safeEntryIdx + 1}/{total}
                </Text>
                <Pressable
                  onPress={() => setEntryIdx(Math.min(total - 1, safeEntryIdx + 1))}
                  disabled={safeEntryIdx === total - 1}
                  className="p-1"
                >
                  <ChevronRight
                    size={18}
                    className={safeEntryIdx === total - 1 ? "text-muted" : "text-foreground"}
                  />
                </Pressable>
              </View>
            )}
            {!isNameResult && (
              <Pressable
                ref={bookmarkRef}
                onPress={() => {
                  bookmarkRef.current?.measureInWindow((x, y, width, height) => {
                    const screenWidth = Dimensions.get("window").width;
                    setBookmarkAnchor({ top: y + height + 4, right: screenWidth - x - width });
                  });
                  quickBookmarkPress();
                }}
                onLongPress={() => {
                  bookmarkRef.current?.measureInWindow((x, y, width, height) => {
                    const screenWidth = Dimensions.get("window").width;
                    setBookmarkAnchor({ top: y + height + 4, right: screenWidth - x - width });
                  });
                  handleLongPress();
                }}
                className="p-1"
              >
                <Bookmark
                  size={20}
                  className={isBookmarked ? "text-foreground fill-foreground" : "text-foreground"}
                />
              </Pressable>
            )}
            <Pressable onPress={onClose} className="p-1">
              <X size={20} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>

        <GestureDetector gesture={swipeGesture}>
          <Animated.View className="flex-1 min-h-0" style={contentAnimatedStyle}>
            {/* Deinflect reasons (shown below pills for multi-word) */}
            {wordResult!.deinflectReasons.length > 0 && (
              <View className="mb-2">
                <View className="bg-muted px-2 py-1 rounded self-start">
                  <Text className="text-xs text-muted-foreground">
                    {formatDeinflectReasons(wordResult!.deinflectReasons)}
                  </Text>
                </View>
              </View>
            )}

            {/* Content display */}
            {isNameResult ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
                <View className="mb-3 flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    {wordResult!.nameMatches!.slice(0, 1).map((name: NameEntry) => {
                      const typeLabel = name.nameType
                        ? (NAME_TYPE_LABELS[name.nameType] ?? name.nameType)
                        : null;
                      return (
                        <View key={name.id} className="flex-row items-center flex-wrap gap-2">
                          {name.kanji && (
                            <Text className="text-2xl font-bold text-foreground">{name.kanji}</Text>
                          )}
                          <Text
                            className={
                              name.kanji
                                ? "text-base text-muted-foreground"
                                : "text-2xl font-bold text-foreground"
                            }
                          >
                            {name.kana}
                          </Text>
                          {typeLabel && (
                            <View className="rounded-md bg-secondary px-2 py-0.5">
                              <Text className="text-xs text-secondary-foreground">{typeLabel}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <LookupKindSwitch
                    variants={lookupKindVariants}
                    selectedIdx={Math.min(selectedVariantIdx, lookupKindVariants.length - 1)}
                    onSelect={(idx) => {
                      setSelectedVariantIdx(idx);
                      setEntryIdx(0);
                    }}
                  />
                </View>
                {wordResult!.nameMatches!.map((name: NameEntry) => {
                  const typeLabel = name.nameType
                    ? (NAME_TYPE_LABELS[name.nameType] ?? name.nameType)
                    : null;
                  return (
                    <View key={name.id} className="flex-row items-center flex-wrap gap-2 mb-2">
                      {name.kanji && (
                        <Text className="text-lg font-bold text-foreground">{name.kanji}</Text>
                      )}
                      <Text
                        className={
                          name.kanji
                            ? "text-sm text-muted-foreground"
                            : "text-lg font-bold text-foreground"
                        }
                      >
                        {name.kana}
                      </Text>
                      {typeLabel && (
                        <View className="rounded-md bg-secondary px-2 py-0.5">
                          <Text className="text-xs text-secondary-foreground">{typeLabel}</Text>
                        </View>
                      )}
                      {name.translation && (
                        <Text className="text-sm text-muted-foreground">{name.translation}</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <Pressable
                onPress={() => {
                  router.push(`/reader/word/${currentEntry!.id}`);
                }}
              >
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
                  <EntrySummary
                    entry={currentEntry!}
                    rightAccessory={
                      <LookupKindSwitch
                        variants={lookupKindVariants}
                        selectedIdx={Math.min(selectedVariantIdx, lookupKindVariants.length - 1)}
                        onSelect={(idx) => {
                          setSelectedVariantIdx(idx);
                          setEntryIdx(0);
                        }}
                      />
                    }
                  />
                </ScrollView>
              </Pressable>
            )}
          </Animated.View>
        </GestureDetector>
      </>
    );
  }

  return (
    <>
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100,
        }}
        pointerEvents="box-none"
      >
        {/* Dismiss area — taps here close the popup, taps pass through to webview once unmounted */}
        <Pressable style={{ flex: 1, cursor: "default" as any }} onPress={onClose} />

        {/* Popup panel */}
        <Animated.View
          style={[
            animatedStyle,
            {
              backgroundColor: "transparent",
            },
          ]}
        >
          <View
            className="bg-background border-t border-border rounded-t-2xl px-4 pt-3"
            style={{
              height: panelContentHeight + Math.max(insets.bottom, 16),
              paddingBottom: Math.max(insets.bottom, 16),
            }}
          >
            {renderContent()}
          </View>
        </Animated.View>
      </View>

      {popoverVisible && currentEntry && (
        <BookmarkPopover
          visible
          onClose={() => {
            dismissPopover();
            setBookmarkAnchor(undefined);
          }}
          entryId={currentEntry.id}
          anchorPosition={bookmarkAnchor}
          onListToggled={onListToggled}
        />
      )}
    </>
  );
}
