import React, { useEffect, useState } from "react";
import { Modal, Pressable, View, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { EntrySummary } from "@/components/EntrySummary";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark, ChevronLeft, ChevronRight, X } from "@/lib/icons";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { LookupResult } from "@/lib/smart-lookup";

interface DictionaryPopupProps {
  visible: boolean;
  onClose: () => void;
  results: LookupResult[];
  loading?: boolean;
}

export function DictionaryPopup({ visible, onClose, results, loading }: DictionaryPopupProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedWordIdx, setSelectedWordIdx] = useState(0);
  const [entryIdx, setEntryIdx] = useState(0);
  const [bookmarkEntryId, setBookmarkEntryId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedWordIdx(0);
    setEntryIdx(0);
  }, [results]);

  const wordResult =
    results.length > 0 ? results[Math.min(selectedWordIdx, results.length - 1)] : null;
  const currentEntry =
    wordResult && wordResult.entries.length > 0
      ? wordResult.entries[Math.min(entryIdx, wordResult.entries.length - 1)]
      : null;
  const safeEntryIdx = wordResult ? Math.min(entryIdx, wordResult.entries.length - 1) : 0;
  const total = wordResult ? wordResult.entries.length : 0;

  const isBookmarked = useBookmarkStore((s) =>
    currentEntry ? s.bookmarkedIds.has(currentEntry.id) : false,
  );

  if (!visible) return null;

  const hasResults = results.length > 0 && results.some((r) => r.entries.length > 0);

  // Loading state
  if (loading && !hasResults) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" onPress={onClose} />
          <View
            className="bg-background border-t border-border rounded-t-2xl px-4 pt-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <View className="items-center py-8">
              <ActivityIndicator size="large" />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // No results (loading finished)
  if (!hasResults) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" onPress={onClose} />
          <View
            className="bg-background border-t border-border rounded-t-2xl px-4 pt-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Text className="text-center text-muted-foreground py-8">No results found</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" onPress={onClose} />
          <View
            className="bg-background border-t border-border rounded-t-2xl px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            {/* Pill tabs for word segments (only when multiple words) */}
            {results.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mb-3"
                contentContainerStyle={{ gap: 8 }}
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
            )}

            {/* Header with close, bookmark, and pagination */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                {wordResult!.deinflectReasons.length > 0 && (
                  <View className="bg-muted px-2 py-1 rounded">
                    <Text className="text-xs text-muted-foreground">
                      {wordResult!.deinflectReasons.join(" → ")}
                    </Text>
                  </View>
                )}
              </View>

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
                <Pressable onPress={() => setBookmarkEntryId(currentEntry!.id)} className="p-1">
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

            {/* Matched text (only when single word — pills already show it for multi-word) */}
            {results.length <= 1 && (
              <View className="mb-2">
                <Text className="text-xs text-muted-foreground">{wordResult!.matchedText}</Text>
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
          </View>
        </View>
      </Modal>

      {bookmarkEntryId !== null && (
        <BookmarkPopover
          visible
          onClose={() => setBookmarkEntryId(null)}
          entryId={bookmarkEntryId}
        />
      )}
    </>
  );
}
