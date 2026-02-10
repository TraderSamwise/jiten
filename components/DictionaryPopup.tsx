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
  const [currentIdx, setCurrentIdx] = useState(0);
  const [bookmarkEntryId, setBookmarkEntryId] = useState<number | null>(null);

  useEffect(() => {
    setCurrentIdx(0);
  }, [results]);

  // Flatten results into a flat entry list with metadata
  const flatEntries = results.flatMap((r) =>
    r.entries.map((entry) => ({
      entry,
      matchedText: r.matchedText,
      reasons: r.deinflectReasons,
    })),
  );

  const total = flatEntries.length;

  const current = total > 0 ? flatEntries[Math.min(currentIdx, total - 1)] : null;
  const idx = Math.min(currentIdx, total - 1);
  const isBookmarked = useBookmarkStore((s) =>
    current ? s.bookmarkedIds.has(current.entry.id) : false,
  );

  if (!visible) return null;

  // Loading state
  if (loading && total === 0) {
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
  if (total === 0) {
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
            {/* Header with close, bookmark, and pagination */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                {current!.reasons.length > 0 && (
                  <View className="bg-muted px-2 py-1 rounded">
                    <Text className="text-xs text-muted-foreground">
                      {current!.reasons.join(" → ")}
                    </Text>
                  </View>
                )}
              </View>

              <View className="flex-row items-center gap-2">
                {total > 1 && (
                  <View className="flex-row items-center gap-1">
                    <Pressable
                      onPress={() => setCurrentIdx(Math.max(0, idx - 1))}
                      disabled={idx === 0}
                      className="p-1"
                    >
                      <ChevronLeft
                        size={18}
                        className={idx === 0 ? "text-muted" : "text-foreground"}
                      />
                    </Pressable>
                    <Text className="text-sm text-muted-foreground">
                      {idx + 1}/{total}
                    </Text>
                    <Pressable
                      onPress={() => setCurrentIdx(Math.min(total - 1, idx + 1))}
                      disabled={idx === total - 1}
                      className="p-1"
                    >
                      <ChevronRight
                        size={18}
                        className={idx === total - 1 ? "text-muted" : "text-foreground"}
                      />
                    </Pressable>
                  </View>
                )}
                <Pressable onPress={() => setBookmarkEntryId(current!.entry.id)} className="p-1">
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

            {/* Matched text */}
            <View className="mb-2">
              <Text className="text-xs text-muted-foreground">{current!.matchedText}</Text>
            </View>

            {/* Entry display — tap to navigate to full detail */}
            <Pressable
              onPress={() => {
                onClose();
                router.push(`/reader/word/${current!.entry.id}`);
              }}
            >
              <ScrollView style={{ maxHeight: 200 }}>
                <EntrySummary entry={current!.entry} />
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
