import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { PitchAccent } from "@/components/PitchAccent";
import { ChevronRight } from "@/lib/icons";
import { useSearchStore } from "@/stores/search";
import type { GlossGroup } from "@/db/types";

interface GlossGroupCardProps {
  group: GlossGroup;
}

export function GlossGroupCard({ group }: GlossGroupCardProps) {
  const router = useRouter();
  const setSelectedGlossGroup = useSearchStore((s) => s.setSelectedGlossGroup);
  const isMulti = group.entries.length > 1;

  const handlePress = () => {
    if (isMulti) {
      setSelectedGlossGroup(group);
      router.push("/dictionary/gloss-group");
    } else {
      router.push(`/dictionary/word/${group.entries[0].id}`);
    }
  };

  if (!isMulti) {
    const entry = group.entries[0];
    const kanjiText = entry.kanji[0]?.text;
    const kana = entry.kana[0];
    const accents = kana ? entry.pitchAccents.filter((pa) => pa.reading === kana.text) : [];

    return (
      <PressableCard className="mb-2" onPress={handlePress}>
        <Text className="text-base font-bold text-foreground">{group.gloss}</Text>
        <View className="flex-row items-center gap-2 mt-1">
          {kanjiText && <Text className="text-lg text-foreground">{kanjiText}</Text>}
          {kana &&
            (accents.length > 0 ? (
              <View className="flex-row items-center gap-1">
                {accents.map((pa, i) => (
                  <PitchAccent key={i} accent={pa} />
                ))}
              </View>
            ) : (
              <Text className="text-sm text-muted-foreground">{kana.text}</Text>
            ))}
        </View>
      </PressableCard>
    );
  }

  const japaneseLabels = group.entries
    .map((e) => e.kanji[0]?.text ?? e.kana[0]?.text ?? "")
    .filter(Boolean)
    .join(", ");

  return (
    <PressableCard className="mb-2" onPress={handlePress}>
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground">{group.gloss}</Text>
          <Text className="mt-1 text-sm text-muted-foreground" numberOfLines={1}>
            {japaneseLabels}
          </Text>
        </View>
        <ChevronRight size={20} className="text-muted-foreground ml-2" />
      </View>
    </PressableCard>
  );
}
