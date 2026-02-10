import React, { useEffect, useState } from "react";
import { Modal, Pressable, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { ChevronLeft, ChevronRight, X } from "@/lib/icons";
import type { LookupResult } from "@/lib/smart-lookup";
import type { DictEntry } from "@/db/types";

interface DictionaryPopupProps {
  visible: boolean;
  onClose: () => void;
  results: LookupResult[];
}

function formatReading(entry: DictEntry): string {
  const kanji = entry.kanji[0]?.text ?? "";
  const kana = entry.kana[0]?.text ?? "";
  if (kanji && kana) return `${kanji}【${kana}】`;
  return kanji || kana;
}

function formatMeaning(entry: DictEntry): string {
  return entry.senses.map((s) => s.glosses.map((g) => g.text).join("; ")).join(" / ");
}

function formatPos(entry: DictEntry): string {
  const pos = entry.senses.flatMap((s) => s.partOfSpeech).filter(Boolean);
  return [...new Set(pos)].join(", ");
}

export function DictionaryPopup({ visible, onClose, results }: DictionaryPopupProps) {
  const insets = useSafeAreaInsets();
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

  if (total === 0 && visible) {
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

  if (!visible || total === 0) return null;

  const current = flatEntries[Math.min(currentIdx, total - 1)];
  const idx = Math.min(currentIdx, total - 1);

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" onPress={onClose} />
          <View
            className="bg-background border-t border-border rounded-t-2xl px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            {/* Header with close and pagination */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                {current.reasons.length > 0 && (
                  <View className="bg-muted px-2 py-1 rounded">
                    <Text className="text-xs text-muted-foreground">
                      {current.reasons.join(" → ")}
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
                <Pressable onPress={onClose} className="p-1">
                  <X size={20} className="text-muted-foreground" />
                </Pressable>
              </View>
            </View>

            {/* Matched text */}
            <View className="mb-2">
              <Text className="text-xs text-muted-foreground">{current.matchedText}</Text>
            </View>

            {/* Word display */}
            <ScrollView style={{ maxHeight: 200 }}>
              <Text className="text-2xl font-bold text-foreground mb-1">
                {formatReading(current.entry)}
              </Text>

              {formatPos(current.entry) ? (
                <Text className="text-xs text-muted-foreground mb-2">
                  {formatPos(current.entry)}
                </Text>
              ) : null}

              <Text className="text-base text-foreground leading-6">
                {formatMeaning(current.entry)}
              </Text>
            </ScrollView>

            {/* Add to list button */}
            <View className="mt-3">
              <Button label="Add to list" onPress={() => setBookmarkEntryId(current.entry.id)} />
            </View>
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
