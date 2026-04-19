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
  rightAccessory?: React.ReactNode;
}

export const EntrySummary = React.memo(function EntrySummary({
  entry,
  variant = "default",
  rightAccessory,
}: EntrySummaryProps) {
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`e:${entry.id}`));
  const primaryKanji = entry.kanji[0]?.text;
  const primaryKana = entry.kana[0]?.text;
  const primaryGloss = entry.senses[0]?.glosses
    .filter((g) => g.lang === "eng")
    .map((g) => g.text)
    .join("; ");
  const pos = entry.senses[0]?.partOfSpeech?.join(", ");

  const bookmarkClass = isBookmarked ? "border-l-4 border-l-primary pl-2" : "";

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
  const readingRows = entry.kana.map((kana) => ({
    kana,
    accents: entry.pitchAccents.filter((pa) => pa.reading === kana.text),
  }));
  const leadReading = readingRows[0] ?? null;
  const stackedReadings = primaryKanji ? readingRows : readingRows.slice(1);
  const MAX_SENSES = 3;
  const sensesToShow = entry.senses.slice(0, MAX_SENSES);
  const hasMore = entry.senses.length > MAX_SENSES;

  return (
    <View className={bookmarkClass}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-3">
            {primaryKanji ? (
              <Text className="text-2xl font-bold text-foreground">{primaryKanji}</Text>
            ) : leadReading?.accents.length ? (
              leadReading.accents.map((pa, i) => <PitchAccent key={i} accent={pa} fontSize={20} />)
            ) : (
              <Text className="text-2xl font-bold text-foreground">{primaryKana}</Text>
            )}
            {entry.common && <Badge variant="common" label="common" />}
            {entry.jlptLevel != null && <Badge variant="secondary" label={`N${entry.jlptLevel}`} />}
          </View>
          {stackedReadings.length > 0 && (
            <View className="gap-1">
              {stackedReadings.map(({ kana, accents: rowAccents }, i) => (
                <View key={`${kana.text}-${i}`} className="flex-row flex-wrap items-center gap-2">
                  {rowAccents.length > 0 ? (
                    rowAccents.map((pa, j) => <PitchAccent key={j} accent={pa} />)
                  ) : (
                    <Text className="text-base text-muted-foreground">{kana.text}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
        {rightAccessory ? <View className="shrink-0">{rightAccessory}</View> : null}
      </View>
      {sensesToShow.map((sense, i) => {
        const sensePos = sense.partOfSpeech?.join(", ");
        const senseGloss = sense.glosses
          .filter((g) => g.lang === "eng")
          .map((g) => g.text)
          .join("; ");
        if (!sensePos && !senseGloss) return null;
        return (
          <Text
            key={i}
            className={`${i === 0 ? "mt-1" : "mt-0.5"} text-sm text-foreground`}
            numberOfLines={2}
          >
            {sensesToShow.length > 1 && (
              <Text className="text-xs text-muted-foreground">{i + 1}. </Text>
            )}
            {sensePos && (
              <Text className="text-xs text-muted-foreground italic">
                {sensePos}
                {"   "}
              </Text>
            )}
            {senseGloss}
          </Text>
        );
      })}
      {hasMore && (
        <Text className="mt-0.5 text-xs text-muted-foreground">
          +{entry.senses.length - MAX_SENSES} more…
        </Text>
      )}
    </View>
  );
});
