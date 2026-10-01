import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { Check, Trash2, X } from "@/lib/icons";
import type { FuriganaReadingCandidate } from "@tradersamwise/jiten-reader-react-native";

export interface FuriganaPinSheetProps {
  visible: boolean;
  /** The kanji run the long press landed on. */
  run: string;
  candidates: FuriganaReadingCandidate[];
  loading: boolean;
  /** The reading pinned for this run, or null when none is. */
  pinnedReading: string | null;
  onChoose: (reading: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Where a reading came from, in the words the rest of the app uses. */
const SOURCE_LABELS: Record<FuriganaReadingCandidate["source"], string> = {
  current: "On the page",
  source: "From the book",
  name: "Name",
  word: "Word",
  counter: "Counter",
};

/**
 * Which reading should this run carry in this book?
 *
 * The list is every reading the dictionaries know, best first, because no
 * ranking settles 杏子 — きょうこ in one book and the apricot in the next. The
 * two rows under it are the ways out: show no furigana here at all, or give
 * the run back to the dictionary.
 */
export function FuriganaPinSheet({
  visible,
  run,
  candidates,
  loading,
  pinnedReading,
  onChoose,
  onRemove,
  onClose,
}: FuriganaPinSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{ paddingBottom: insets.bottom + 8 }}
          className="max-h-[70%] rounded-t-2xl border-t border-border bg-background"
        >
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <View className="flex-1">
              <Text className="text-xl font-semibold text-foreground" numberOfLines={1}>
                {run}
              </Text>
              <Text className="text-xs text-muted-foreground">Reading for this book</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} className="p-1">
              <X size={18} className="text-muted-foreground" />
            </Pressable>
          </View>

          <ScrollView>
            {loading ? (
              <View className="items-center py-6">
                <ActivityIndicator />
              </View>
            ) : candidates.length === 0 ? (
              <Text className="px-4 py-6 text-sm text-muted-foreground">
                No reading is known for {run}.
              </Text>
            ) : (
              candidates.map((candidate) => {
                const isPinned = pinnedReading === candidate.reading;
                return (
                  <Pressable
                    key={candidate.reading}
                    onPress={() => onChoose(candidate.reading)}
                    className="flex-row items-center gap-3 border-b border-border/50 px-4 py-3"
                  >
                    <View className="flex-1">
                      <Text className="text-base text-foreground">{candidate.reading}</Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                        {[SOURCE_LABELS[candidate.source], candidate.label, candidate.note]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    {isPinned ? <Check size={18} className="text-primary" /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* Outside the scroll area: twenty readings would otherwise push the
              two ways out off the bottom of the sheet. */}
          <View className="border-t border-border">
            <Pressable
              onPress={() => onChoose("")}
              className="flex-row items-center gap-3 px-4 py-3"
            >
              <Text className="flex-1 text-base text-foreground">No furigana</Text>
              {pinnedReading === "" ? <Check size={18} className="text-primary" /> : null}
            </Pressable>

            {pinnedReading !== null ? (
              <Pressable
                onPress={onRemove}
                className="flex-row items-center gap-3 border-t border-border/50 px-4 py-3"
              >
                <Trash2 size={16} className="text-destructive" />
                <Text className="flex-1 text-base text-destructive">Remove pinned reading</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
