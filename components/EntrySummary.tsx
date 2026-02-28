import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { PitchAccent } from "@/components/PitchAccent";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { DictEntry } from "@/db/types";

interface EntrySummaryProps {
  entry: DictEntry;
  variant?: "default" | "compact";
}

export function EntrySummary({ entry, variant = "default" }: EntrySummaryProps) {
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`e:${entry.id}`));
  const primaryKanji = entry.kanji[0]?.text;
  const primaryKana = entry.kana[0]?.text;
  const primaryGloss = entry.senses[0]?.glosses
    .filter((g) => g.lang === "eng")
    .map((g) => g.text)
    .join("; ");
  const pos = entry.senses[0]?.partOfSpeech?.join(", ");

  const bookmarkClass = isBookmarked ? "border-l-4 border-l-primary bg-primary/5 pl-2" : "";

  if (variant === "compact") {
    return (
      <View className={bookmarkClass}>
        <View className="flex-row items-baseline gap-2">
          {primaryKanji && (
            <Text className="text-lg font-bold text-foreground">{primaryKanji}</Text>
          )}
          {primaryKana && <Text className="text-sm text-muted-foreground">{primaryKana}</Text>}
          {primaryGloss && (
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
              {primaryGloss}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // default variant
  const accents = primaryKana ? entry.pitchAccents.filter((pa) => pa.reading === primaryKana) : [];

  return (
    <View className={bookmarkClass}>
      <View className="flex-row items-center gap-3">
        {primaryKanji && <Text className="text-2xl font-bold text-foreground">{primaryKanji}</Text>}
        {accents.length > 0 ? (
          <View className="flex-row flex-wrap items-baseline gap-2">
            {accents.map((pa, i) => (
              <PitchAccent key={i} accent={pa} />
            ))}
          </View>
        ) : (
          <Text className="text-base text-muted-foreground">{primaryKana}</Text>
        )}
        {entry.common && <Badge variant="common" label="common" />}
      </View>
      {pos && <Text className="mt-1 text-xs text-muted-foreground italic">{pos}</Text>}
      {primaryGloss && (
        <Text className="mt-1 text-sm text-foreground" numberOfLines={2}>
          {primaryGloss}
        </Text>
      )}
    </View>
  );
}
