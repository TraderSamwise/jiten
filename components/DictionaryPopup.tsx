import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, View, ScrollView, ActivityIndicator, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { EntrySummary } from "@/components/EntrySummary";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark, ChevronLeft, ChevronRight, X } from "@/lib/icons";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmark } from "@/hooks/useQuickBookmark";
import type { LookupResult } from "@/lib/smart-lookup";

interface DictionaryPopupProps {
  visible: boolean;
  onClose: () => void;
  results: LookupResult[];
  loading?: boolean;
  errorMessage?: string | null;
}

const SLIDE_DURATION = 250;

export function DictionaryPopup({
  visible,
  onClose,
  results,
  loading,
  errorMessage,
}: DictionaryPopupProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedWordIdx, setSelectedWordIdx] = useState(0);
  const [entryIdx, setEntryIdx] = useState(0);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<
    { top: number; right: number } | undefined
  >();
  const bookmarkRef = useRef<View>(null);
  const [mounted, setMounted] = useState(false);

  const translateY = useSharedValue(400);

  useEffect(() => {
    setSelectedWordIdx(0);
    setEntryIdx(0);
  }, [results]);

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

  const wordResult =
    results.length > 0 ? results[Math.min(selectedWordIdx, results.length - 1)] : null;
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

  if (!mounted) return null;

  const hasResults = results.length > 0 && results.some((r) => r.entries.length > 0);

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
                    key={i}
                    onPress={() => {
                      setSelectedWordIdx(i);
                      setEntryIdx(0);
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
                {wordResult!.deinflectReasons.length > 0 && (
                  <View className="bg-muted px-2 py-1 rounded">
                    <Text className="text-xs text-muted-foreground">
                      {wordResult!.deinflectReasons.join(" → ")}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Right side: fixed controls */}
          <View className="flex-row items-center gap-2">
            {total > 1 && (
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
                fill={isBookmarked ? "currentColor" : "none"}
                className="text-foreground"
              />
            </Pressable>
            <Pressable onPress={onClose} className="p-1">
              <X size={20} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>

        {/* Deinflect reasons (shown below pills for multi-word) */}
        {results.length > 1 && wordResult!.deinflectReasons.length > 0 && (
          <View className="mb-2">
            <View className="bg-muted px-2 py-1 rounded self-start">
              <Text className="text-xs text-muted-foreground">
                {wordResult!.deinflectReasons.join(" → ")}
              </Text>
            </View>
          </View>
        )}

        {/* Entry display — tap to navigate to full detail */}
        <Pressable
          onPress={() => {
            onClose();
            router.push(`/reader/word/${currentEntry!.id}`);
          }}
        >
          <ScrollView style={{ maxHeight: 200 }}>
            <EntrySummary entry={currentEntry!} />
          </ScrollView>
        </Pressable>

        {Platform.OS === "ios" && currentEntry && (() => {
          const query = currentEntry.kanji[0]?.text ?? currentEntry.kana[0]?.text ?? "";
          const encoded = encodeURIComponent(query);
          return (
            <View className="mt-3">
              <Text className="text-xs text-muted-foreground mb-1.5">Open in...</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  label="Midori"
                  onPress={() => {
                    Linking.openURL(`midori://search?text=${encoded}`).catch(() => {
                      Linking.openURL("https://apps.apple.com/app/midori-japanese-dictionary/id385231773");
                    });
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  label="Shirabe Jisho"
                  onPress={() => {
                    Linking.openURL(`shirabelookup://search?w=${encoded}`).catch(() => {
                      Linking.openURL("https://apps.apple.com/app/shirabe-jisho/id1005203380");
                    });
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  label="DaKanji"
                  onPress={() => {
                    Linking.openURL(`dakanji://dictionary?search=${encoded}`).catch(() => {
                      Linking.openURL("https://apps.apple.com/app/dakanji/id1548746810");
                    });
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  label="imiwa?"
                  onPress={() => {
                    Linking.openURL(`imiwa://analyser?text=${encoded}`).catch(() => {
                      Linking.openURL("https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125");
                    });
                  }}
                />
              </View>
            </View>
          );
        })()}
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
        <Pressable style={{ flex: 1 }} onPress={onClose} />

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
            style={{ paddingBottom: 0 }}
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
