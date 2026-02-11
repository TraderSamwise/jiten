import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import type { KanjiCharacter } from "@/db/types";

interface KanjiCardProps {
  kanji: KanjiCharacter;
}

export function KanjiCard({ kanji }: KanjiCardProps) {
  const router = useRouter();

  const onReadings = kanji.readingsOn.join(" · ");
  const meanings = kanji.meanings.slice(0, 3).join(", ");

  return (
    <PressableCard
      className="mb-2"
      onPress={() => router.push(`/dictionary/kanji/${encodeURIComponent(kanji.literal)}`)}
    >
      <View className="flex-row items-start gap-3">
        <Text className="text-3xl font-bold text-foreground leading-tight">{kanji.literal}</Text>
        <View className="flex-1">
          {onReadings.length > 0 && (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              {onReadings}
            </Text>
          )}
          {meanings.length > 0 && (
            <Text className="text-base text-foreground mt-0.5" numberOfLines={1}>
              {meanings}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-1.5 mt-1.5">
            {kanji.grade != null && <Badge variant="secondary" label={`Grade ${kanji.grade}`} />}
            {kanji.jlptLevel != null && <Badge variant="secondary" label={`N${kanji.jlptLevel}`} />}
            {kanji.frequencyRank != null && (
              <Badge variant="outline" label={`#${kanji.frequencyRank}`} />
            )}
          </View>
        </View>
      </View>
    </PressableCard>
  );
}
