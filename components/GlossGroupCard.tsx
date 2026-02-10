import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
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

  const japaneseLabels = group.entries
    .map((e) => e.kanji[0]?.text ?? e.kana[0]?.text ?? "")
    .filter(Boolean)
    .join(", ");

  const handlePress = () => {
    if (isMulti) {
      setSelectedGlossGroup(group);
      router.push("/dictionary/gloss-group");
    } else {
      router.push(`/dictionary/word/${group.entries[0].id}`);
    }
  };

  return (
    <PressableCard className="mb-2" onPress={handlePress}>
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground">{group.gloss}</Text>
          <Text className="mt-1 text-sm text-muted-foreground" numberOfLines={1}>
            {japaneseLabels}
          </Text>
        </View>
        {isMulti && <ChevronRight size={20} className="text-muted-foreground ml-2" />}
      </View>
    </PressableCard>
  );
}
