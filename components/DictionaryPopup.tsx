import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, View, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
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

interface FlatLookupItem {
  wordIdx: number;
  variantIdx: number;
  entryIdx: number;
}

interface PanelPayload {
  item: FlatLookupItem | null;
  result: LookupResult | null;
  panelWordResult: LookupResult | null;
  panelEntry: LookupResult["entries"][number] | null;
  panelIsNameResult: boolean;
  panelTotal: number;
  panelSafeEntryIdx: number;
  panelLookupVariants: LookupResult[];
}

interface PanelWindow {
  left: PanelPayload | null;
  center: PanelPayload | null;
  right: PanelPayload | null;
}

const SLIDE_DURATION = 250;
const SEGMENT_SWIPE_THRESHOLD = 18;
const SEGMENT_SWIPE_VELOCITY = 380;
const SEGMENT_SWIPE_SNAP_RATIO = 0.22;
const MAX_POPUP_BODY_HEIGHT = 220;

function areSameItem(a: FlatLookupItem | null, b: FlatLookupItem | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.wordIdx === b.wordIdx && a.variantIdx === b.variantIdx && a.entryIdx === b.entryIdx;
}

function getItemKey(item: FlatLookupItem | null): string {
  if (!item) return "empty";
  return `${item.wordIdx}:${item.variantIdx}:${item.entryIdx}`;
}

function areSamePayload(a: PanelPayload | null, b: PanelPayload | null): boolean {
  return areSameItem(a?.item ?? null, b?.item ?? null);
}

function getFlatItemsForSelection(
  results: LookupResult[],
  selectedWordIdx: number,
  selectedVariantIdx: number,
): FlatLookupItem[] {
  const items: FlatLookupItem[] = [];
  results.forEach((result, wordIdx) => {
    const variantIdx = wordIdx === selectedWordIdx ? selectedVariantIdx : 0;
    const variants = result.alternateResults ?? [];
    const panel =
      variants.length > 0 ? variants[Math.min(variantIdx, variants.length - 1)] : result;
    if (panel.nameMatches && panel.nameMatches.length > 0 && panel.entries.length === 0) {
      items.push({ wordIdx, variantIdx, entryIdx: 0 });
      return;
    }
    const entryCount = Math.max(panel.entries.length, 1);
    for (let i = 0; i < entryCount; i++) {
      items.push({ wordIdx, variantIdx, entryIdx: i });
    }
  });
  return items;
}

function getSelectedFlatIdx(flatItems: FlatLookupItem[], item: FlatLookupItem): number {
  const idx = flatItems.findIndex(
    (candidate) =>
      candidate.wordIdx === item.wordIdx &&
      candidate.variantIdx === item.variantIdx &&
      candidate.entryIdx === item.entryIdx,
  );
  return idx >= 0 ? idx : 0;
}

function buildPanelPayload(
  results: LookupResult[],
  item: FlatLookupItem | null,
): PanelPayload | null {
  if (!item) return null;
  const result = results[item.wordIdx];
  if (!result) return null;
  const variants = result.alternateResults ?? [];
  const panelWordResult =
    variants.length > 0 ? variants[Math.min(item.variantIdx, variants.length - 1)] : result;
  const panelEntry =
    panelWordResult.entries.length > 0
      ? panelWordResult.entries[Math.min(item.entryIdx, panelWordResult.entries.length - 1)]
      : null;
  return {
    item,
    result,
    panelWordResult,
    panelEntry,
    panelIsNameResult: !!(
      panelWordResult.nameMatches &&
      panelWordResult.nameMatches.length > 0 &&
      !panelEntry
    ),
    panelTotal: panelWordResult.entries.length,
    panelSafeEntryIdx:
      panelWordResult.entries.length > 0
        ? Math.min(item.entryIdx, panelWordResult.entries.length - 1)
        : 0,
    panelLookupVariants: variants.length > 0 ? variants : [panelWordResult],
  };
}

function buildPanelWindow(
  flatItems: FlatLookupItem[],
  selectedFlatIdx: number,
  results: LookupResult[],
): PanelWindow {
  return {
    left: buildPanelPayload(results, selectedFlatIdx > 0 ? flatItems[selectedFlatIdx - 1] : null),
    center: buildPanelPayload(results, flatItems[selectedFlatIdx] ?? null),
    right: buildPanelPayload(
      results,
      selectedFlatIdx < flatItems.length - 1 ? flatItems[selectedFlatIdx + 1] : null,
    ),
  };
}

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
  disabled,
}: {
  variants: LookupResult[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  disabled?: boolean;
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
          disabled={disabled}
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
  const [selection, setSelection] = useState<FlatLookupItem>({
    wordIdx: 0,
    variantIdx: 0,
    entryIdx: 0,
  });
  const [highlightedWordIdx, setHighlightedWordIdx] = useState(0);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<
    { top: number; right: number } | undefined
  >();
  const bookmarkRef = useRef<View>(null);
  const tabScrollRef = useRef<ScrollView>(null);
  const [mounted, setMounted] = useState(false);
  const isSegmentTransitioningRef = useRef(false);
  const pendingResetFrameRef = useRef<number | null>(null);
  const pendingFinalizeFrameRef = useRef<number | null>(null);
  const [pagerWidth, setPagerWidth] = useState(0);
  const [tabRowWidth, setTabRowWidth] = useState(0);
  const tabLayoutsRef = useRef<Record<number, { x: number; width: number }>>({});
  const [stagingWindow, setStagingWindow] = useState<PanelWindow | null>(null);
  const [useStagingLayer, setUseStagingLayer] = useState(false);

  const translateY = useSharedValue(400);
  const pagerTranslateX = useSharedValue(0);

  useEffect(() => {
    setSelection({ wordIdx: 0, variantIdx: 0, entryIdx: 0 });
    setHighlightedWordIdx(0);
  }, [results]);

  useEffect(
    () => () => {
      if (pendingResetFrameRef.current !== null) {
        cancelAnimationFrame(pendingResetFrameRef.current);
      }
      if (pendingFinalizeFrameRef.current !== null) {
        cancelAnimationFrame(pendingFinalizeFrameRef.current);
      }
    },
    [],
  );

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
    transform: [{ translateX: pagerTranslateX.value - pagerWidth }],
  }));

  const selectedWordIdx = selection.wordIdx;
  const selectedVariantIdx = selection.variantIdx;
  const entryIdx = selection.entryIdx;

  const hasResults =
    results.length > 0 &&
    results.some((r) => r.entries.length > 0 || (r.nameMatches && r.nameMatches.length > 0));
  const selectedItem = useMemo<FlatLookupItem>(
    () => ({ wordIdx: selectedWordIdx, variantIdx: selectedVariantIdx, entryIdx }),
    [selectedWordIdx, selectedVariantIdx, entryIdx],
  );
  const flatItems = useMemo(
    () => getFlatItemsForSelection(results, selectedWordIdx, selectedVariantIdx),
    [results, selectedWordIdx, selectedVariantIdx],
  );
  const selectedFlatIdx = useMemo(
    () => getSelectedFlatIdx(flatItems, selectedItem),
    [flatItems, selectedItem],
  );
  const [panelWindow, setPanelWindow] = useState<PanelWindow>({
    left: null,
    center: null,
    right: null,
  });
  const visibleWindow = useStagingLayer && stagingWindow ? stagingWindow : panelWindow;
  const centerPayload = visibleWindow.center;
  const currentEntry = centerPayload?.panelEntry ?? null;
  const isNameResult = centerPayload?.panelIsNameResult ?? false;
  const total = centerPayload?.panelTotal ?? 0;
  const safeEntryIdx = centerPayload?.panelSafeEntryIdx ?? 0;

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

  useEffect(() => {
    if (isSegmentTransitioningRef.current) return;
    const nextWindow = buildPanelWindow(flatItems, selectedFlatIdx, results);
    setPanelWindow((currentWindow) =>
      areSamePayload(currentWindow.left, nextWindow.left) &&
      areSamePayload(currentWindow.center, nextWindow.center) &&
      areSamePayload(currentWindow.right, nextWindow.right)
        ? currentWindow
        : nextWindow,
    );
  }, [flatItems, results, selectedFlatIdx]);

  const ensureActiveTabVisible = useCallback(
    (wordIdx: number) => {
      const layout = tabLayoutsRef.current[wordIdx];
      if (!layout || tabRowWidth <= 0) return;
      const targetX = Math.max(0, layout.x - Math.max(16, (tabRowWidth - layout.width) / 2));
      tabScrollRef.current?.scrollTo({ x: targetX, animated: true });
    },
    [tabRowWidth],
  );

  useEffect(() => {
    if (results.length <= 1) return;
    ensureActiveTabVisible(highlightedWordIdx);
  }, [ensureActiveTabVisible, highlightedWordIdx, results.length]);

  const finishSegmentTransition = useCallback(() => {
    isSegmentTransitioningRef.current = false;
    setUseStagingLayer(false);
    setStagingWindow(null);
  }, []);

  const commitAnimatedFlatItem = useCallback(
    (nextItem: FlatLookupItem, direction: 1 | -1) => {
      const nextFlatItems = getFlatItemsForSelection(
        results,
        nextItem.wordIdx,
        nextItem.variantIdx,
      );
      const nextFlatIdx = getSelectedFlatIdx(nextFlatItems, nextItem);
      setSelection(nextItem);
      setHighlightedWordIdx(nextItem.wordIdx);
      const nextPayload = buildPanelPayload(results, nextItem);
      const finalWindow = buildPanelWindow(nextFlatItems, nextFlatIdx, results);
      if (!nextPayload) {
        finishSegmentTransition();
        return;
      }
      setStagingWindow(finalWindow);
      setUseStagingLayer(true);
      if (pendingResetFrameRef.current !== null) {
        cancelAnimationFrame(pendingResetFrameRef.current);
      }
      if (pendingFinalizeFrameRef.current !== null) {
        cancelAnimationFrame(pendingFinalizeFrameRef.current);
      }
      pendingResetFrameRef.current = requestAnimationFrame(() => {
        pendingResetFrameRef.current = null;
        pagerTranslateX.value = 0;
        pendingFinalizeFrameRef.current = requestAnimationFrame(() => {
          pendingFinalizeFrameRef.current = null;
          setPanelWindow(finalWindow);
          requestAnimationFrame(() => {
            finishSegmentTransition();
          });
        });
      });
    },
    [finishSegmentTransition, pagerTranslateX, results],
  );

  const selectFlatIndex = useCallback(
    (nextFlatIdx: number, direction: 1 | -1, releaseVelocity: number = 0) => {
      if (nextFlatIdx < 0 || nextFlatIdx >= flatItems.length || pagerWidth <= 0) return;
      if (nextFlatIdx === selectedFlatIdx || isSegmentTransitioningRef.current) return;
      const nextItem = flatItems[nextFlatIdx];
      if (!nextItem) return;
      isSegmentTransitioningRef.current = true;
      if (direction > 0) {
        const nextPayload = buildPanelPayload(results, nextItem);
        setPanelWindow((currentWindow) => ({
          left: currentWindow.left,
          center: currentWindow.center,
          right: nextPayload,
        }));
      } else {
        const nextPayload = buildPanelPayload(results, nextItem);
        setPanelWindow((currentWindow) => ({
          left: nextPayload,
          center: currentWindow.center,
          right: currentWindow.right,
        }));
      }
      pagerTranslateX.value = withSpring(
        direction < 0 ? pagerWidth : -pagerWidth,
        {
          damping: 24,
          stiffness: 260,
          mass: 0.75,
          velocity: releaseVelocity,
          overshootClamping: true,
        },
        (finished) => {
          if (finished) {
            runOnJS(commitAnimatedFlatItem)(nextItem, direction);
          } else {
            runOnJS(finishSegmentTransition)();
          }
        },
      );
    },
    [
      flatItems,
      selectedFlatIdx,
      pagerWidth,
      commitAnimatedFlatItem,
      finishSegmentTransition,
      pagerTranslateX,
      results,
    ],
  );

  const jumpToWordIndex = useCallback(
    (nextWordIdx: number) => {
      if (nextWordIdx < 0 || nextWordIdx >= results.length) return;
      const nextItem: FlatLookupItem = { wordIdx: nextWordIdx, variantIdx: 0, entryIdx: 0 };
      const nextFlatItems = getFlatItemsForSelection(results, nextWordIdx, 0);
      const nextFlatIdx = getSelectedFlatIdx(nextFlatItems, nextItem);
      isSegmentTransitioningRef.current = false;
      if (pendingResetFrameRef.current !== null) {
        cancelAnimationFrame(pendingResetFrameRef.current);
        pendingResetFrameRef.current = null;
      }
      if (pendingFinalizeFrameRef.current !== null) {
        cancelAnimationFrame(pendingFinalizeFrameRef.current);
        pendingFinalizeFrameRef.current = null;
      }
      pagerTranslateX.value = 0;
      setHighlightedWordIdx(nextWordIdx);
      setSelection(nextItem);
      setPanelWindow(buildPanelWindow(nextFlatItems, nextFlatIdx, results));
    },
    [pagerTranslateX, results],
  );

  const animateToWordIndex = useCallback(
    (nextWordIdx: number) => {
      if (nextWordIdx < 0 || nextWordIdx >= results.length) return;
      setHighlightedWordIdx(nextWordIdx);
      const targetItem: FlatLookupItem = { wordIdx: nextWordIdx, variantIdx: 0, entryIdx: 0 };
      const targetFlatIdx = flatItems.findIndex((item) => areSameItem(item, targetItem));
      if (
        targetFlatIdx >= 0 &&
        pagerWidth > 0 &&
        targetFlatIdx !== selectedFlatIdx &&
        !isSegmentTransitioningRef.current
      ) {
        selectFlatIndex(targetFlatIdx, targetFlatIdx > selectedFlatIdx ? 1 : -1);
        return;
      }
      jumpToWordIndex(nextWordIdx);
    },
    [flatItems, jumpToWordIndex, pagerWidth, results.length, selectFlatIndex, selectedFlatIdx],
  );

  const animateByDelta = useCallback(
    (delta: -1 | 1) => {
      const targetFlatIdx = selectedFlatIdx + delta;
      if (targetFlatIdx < 0 || targetFlatIdx >= flatItems.length) return;
      if (pagerWidth > 0 && !isSegmentTransitioningRef.current) {
        selectFlatIndex(targetFlatIdx, delta > 0 ? 1 : -1);
        return;
      }
      const nextItem = flatItems[targetFlatIdx];
      if (!nextItem) return;
      setSelection(nextItem);
      setHighlightedWordIdx(nextItem.wordIdx);
    },
    [flatItems, pagerWidth, selectFlatIndex, selectedFlatIdx],
  );

  const swipeGesture = Gesture.Pan()
    .enabled(flatItems.length > 1 && pagerWidth > 0)
    .activeOffsetX([-2, 2])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      if (isSegmentTransitioningRef.current) return;
      let nextTranslate = event.translationX;
      if (selectedFlatIdx === 0 && nextTranslate > 0) nextTranslate *= 0.35;
      if (selectedFlatIdx === flatItems.length - 1 && nextTranslate < 0) nextTranslate *= 0.35;
      pagerTranslateX.value = nextTranslate;
    })
    .onEnd((event) => {
      if (isSegmentTransitioningRef.current) return;
      const absX = Math.abs(event.translationX);
      const absVelocityX = Math.abs(event.velocityX);
      const distanceThreshold = pagerWidth * SEGMENT_SWIPE_SNAP_RATIO;
      const wantsNext =
        event.translationX < -Math.max(SEGMENT_SWIPE_THRESHOLD, distanceThreshold) ||
        event.velocityX < -SEGMENT_SWIPE_VELOCITY;
      const wantsPrev =
        event.translationX > Math.max(SEGMENT_SWIPE_THRESHOLD, distanceThreshold) ||
        event.velocityX > SEGMENT_SWIPE_VELOCITY;
      if (Math.abs(event.translationX) < Math.abs(event.translationY)) {
        pagerTranslateX.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.8 });
        return;
      }
      if (wantsNext && selectedFlatIdx < flatItems.length - 1) {
        runOnJS(selectFlatIndex)(selectedFlatIdx + 1, 1, event.velocityX);
      } else if (wantsPrev && selectedFlatIdx > 0) {
        runOnJS(selectFlatIndex)(selectedFlatIdx - 1, -1, event.velocityX);
      } else {
        if (absX > 0 || absVelocityX > 0) {
          pagerTranslateX.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.8 });
        }
      }
    });

  if (!mounted) return null;

  function renderLookupPanel(
    payload: PanelPayload | null,
    options?: {
      allowNavigate?: boolean;
      isActive?: boolean;
    },
  ) {
    if (!payload || !payload.result || !payload.panelWordResult) return <View />;
    const {
      result,
      panelWordResult,
      panelEntry,
      panelIsNameResult,
      panelTotal,
      panelLookupVariants,
      item,
    } = payload;
    const variantIndex = item?.variantIdx ?? 0;
    const lookupSwitch = (
      <View style={{ marginRight: !panelIsNameResult && panelTotal > 1 ? 84 : 0 }}>
        <LookupKindSwitch
          variants={panelLookupVariants}
          selectedIdx={Math.min(variantIndex, panelLookupVariants.length - 1)}
          disabled={!options?.isActive}
          onSelect={(idx) => {
            setSelection((prev) => ({ ...prev, variantIdx: idx, entryIdx: 0 }));
          }}
        />
      </View>
    );

    return (
      <View>
        {panelIsNameResult ? (
          <ScrollView
            style={{ maxHeight: MAX_POPUP_BODY_HEIGHT }}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            <View className="mb-3 flex-row items-start gap-3">
              <View className="flex-1">
                {panelWordResult.nameMatches!.slice(0, 1).map((name: NameEntry) => {
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
              {lookupSwitch}
            </View>
            {panelWordResult.nameMatches!.map((name: NameEntry) => {
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
            disabled={!options?.allowNavigate}
            onPress={() => {
              if (panelEntry && options?.allowNavigate) {
                router.push(`/reader/word/${panelEntry.id}`);
              }
            }}
          >
            <ScrollView
              style={{ maxHeight: MAX_POPUP_BODY_HEIGHT }}
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              {panelEntry && (
                <EntrySummary
                  entry={panelEntry}
                  inlineMeta={
                    panelWordResult.deinflectReasons.length > 0 ? (
                      <View className="rounded-md bg-muted px-2 py-1">
                        <Text className="text-xs text-muted-foreground">
                          {formatDeinflectReasons(panelWordResult.deinflectReasons)}
                        </Text>
                      </View>
                    ) : null
                  }
                  rightAccessory={lookupSwitch ?? undefined}
                />
              )}
            </ScrollView>
          </Pressable>
        )}
      </View>
    );
  }

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
            <ScrollView
              ref={tabScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
              style={{ flexGrow: 0 }}
              onLayout={(event) => {
                const nextWidth = Math.round(event.nativeEvent.layout.width);
                if (nextWidth > 0 && nextWidth !== tabRowWidth) {
                  setTabRowWidth(nextWidth);
                }
              }}
            >
              {results.map((r, i) => (
                <Pressable
                  key={`${r.lookupKind ?? "lookup"}-${r.matchedText}-${i}`}
                  onLayout={(event) => {
                    const { x, width } = event.nativeEvent.layout;
                    tabLayoutsRef.current[i] = { x, width };
                  }}
                  onPress={() => {
                    animateToWordIndex(i);
                  }}
                  className={`px-3 py-1.5 rounded-full border ${
                    i === Math.min(highlightedWordIdx, results.length - 1)
                      ? "bg-primary/20 border-primary/40"
                      : "border-border"
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      i === Math.min(highlightedWordIdx, results.length - 1)
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {r.matchedText}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Right side: fixed controls */}
          <View className="flex-row items-center gap-2">
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
          <Animated.View
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              if (nextWidth > 0 && nextWidth !== pagerWidth) {
                setPagerWidth(nextWidth);
                pagerTranslateX.value = 0;
              }
            }}
            style={{ overflow: "hidden", position: "relative" }}
          >
            {!centerPayload?.panelIsNameResult && (centerPayload?.panelTotal ?? 0) > 1 && (
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  top: centerPayload?.panelWordResult?.deinflectReasons.length ? 28 : 0,
                  right: 0,
                  zIndex: 2,
                }}
              >
                <View className="flex-row items-center gap-1">
                  <Pressable
                    onPress={() => animateByDelta(-1)}
                    disabled={(centerPayload?.panelSafeEntryIdx ?? 0) === 0}
                    className="p-1"
                  >
                    <ChevronLeft
                      size={18}
                      className={
                        (centerPayload?.panelSafeEntryIdx ?? 0) === 0
                          ? "text-muted"
                          : "text-foreground"
                      }
                    />
                  </Pressable>
                  <Text className="text-xs text-muted-foreground min-w-8 text-center">
                    {(centerPayload?.panelSafeEntryIdx ?? 0) + 1}/{centerPayload?.panelTotal ?? 0}
                  </Text>
                  <Pressable
                    onPress={() => animateByDelta(1)}
                    disabled={
                      (centerPayload?.panelSafeEntryIdx ?? 0) ===
                      (centerPayload?.panelTotal ?? 1) - 1
                    }
                    className="p-1"
                  >
                    <ChevronRight
                      size={18}
                      className={
                        (centerPayload?.panelSafeEntryIdx ?? 0) ===
                        (centerPayload?.panelTotal ?? 1) - 1
                          ? "text-muted"
                          : "text-foreground"
                      }
                    />
                  </Pressable>
                </View>
              </View>
            )}
            <Animated.View
              pointerEvents={useStagingLayer ? "none" : "auto"}
              style={[
                contentAnimatedStyle,
                {
                  flexDirection: "row",
                  alignItems: "flex-start",
                  width: pagerWidth > 0 ? pagerWidth * 3 : "100%",
                  opacity: useStagingLayer ? 0 : 1,
                },
              ]}
            >
              {[panelWindow.left, panelWindow.center, panelWindow.right].map(
                (panelPayload, panelIdx) => (
                  <View
                    key={`panel-${panelIdx}`}
                    style={{
                      width: pagerWidth || undefined,
                      flex: pagerWidth > 0 ? 0 : 1,
                      alignSelf: "flex-start",
                    }}
                  >
                    {renderLookupPanel(panelPayload, {
                      allowNavigate: panelIdx === 1 && !isNameResult,
                      isActive: panelIdx === 1,
                    })}
                  </View>
                ),
              )}
            </Animated.View>
            {useStagingLayer && stagingWindow && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    width: pagerWidth > 0 ? pagerWidth * 3 : "100%",
                    transform: [{ translateX: -(pagerWidth || 0) }],
                  }}
                >
                  {[stagingWindow.left, stagingWindow.center, stagingWindow.right].map(
                    (panelPayload, panelIdx) => (
                      <View
                        key={`staging-panel-${panelIdx}`}
                        style={{
                          width: pagerWidth || undefined,
                          flex: pagerWidth > 0 ? 0 : 1,
                          alignSelf: "flex-start",
                        }}
                      >
                        {renderLookupPanel(panelPayload, {
                          allowNavigate: false,
                          isActive: false,
                        })}
                      </View>
                    ),
                  )}
                </View>
              </View>
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
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
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
