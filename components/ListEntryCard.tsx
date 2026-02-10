import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { DictEntry } from "@/db/types";

interface ListEntryCardProps {
  entry: DictEntry;
}

export function ListEntryCard({ entry }: ListEntryCardProps) {
  const router = useRouter();
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(entry.id));
  const primaryKanji = entry.kanji[0]?.text;
  const primaryKana = entry.kana[0]?.text;
  const primaryGloss = entry.senses[0]?.glosses
    .filter((g) => g.lang === "eng")
    .map((g) => g.text)
    .join("; ");

  return (
    <PressableCard
      className={isBookmarked ? "mb-1 border-l-4 border-l-primary bg-primary/5 p-3" : "mb-1 p-3"}
      onPress={() => router.push(`/lists/word/${entry.id}`)}
    >
      <View className="flex-row items-baseline gap-2">
        {primaryKanji && <Text className="text-lg font-bold text-foreground">{primaryKanji}</Text>}
        {primaryKana && <Text className="text-sm text-muted-foreground">{primaryKana}</Text>}
        {primaryGloss && (
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            {primaryGloss}
          </Text>
        )}
      </View>
    </PressableCard>
  );
}
