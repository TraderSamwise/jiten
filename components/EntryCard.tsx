import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import type { DictEntry } from "@/db/types";

interface EntryCardProps {
  entry: DictEntry;
}

export function EntryCard({ entry }: EntryCardProps) {
  const router = useRouter();
  const primaryKanji = entry.kanji[0]?.text;
  const primaryKana = entry.kana[0]?.text;
  const primaryGloss = entry.senses[0]?.glosses
    .filter((g) => g.lang === "eng")
    .map((g) => g.text)
    .join("; ");
  const pos = entry.senses[0]?.partOfSpeech?.join(", ");

  return (
    <PressableCard
      className="mb-2"
      onPress={() => router.push(`/word/${entry.id}`)}
    >
      <View className="flex-row items-baseline gap-3">
        {primaryKanji && (
          <Text className="text-2xl font-bold text-foreground">
            {primaryKanji}
          </Text>
        )}
        <Text className="text-base text-muted-foreground">{primaryKana}</Text>
        {entry.common && <Badge variant="common" label="common" />}
      </View>
      {pos && (
        <Text className="mt-1 text-xs text-muted-foreground italic">{pos}</Text>
      )}
      {primaryGloss && (
        <Text className="mt-1 text-sm text-foreground" numberOfLines={2}>
          {primaryGloss}
        </Text>
      )}
    </PressableCard>
  );
}
