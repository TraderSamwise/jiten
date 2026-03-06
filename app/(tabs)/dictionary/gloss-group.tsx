import React, { useCallback } from "react";
import { View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Text } from "@/components/ui/text";
import { EntryCard } from "@/components/EntryCard";
import { useSearchStore } from "@/stores/search";
import type { DictEntry } from "@/db/types";

export default function GlossGroupScreen() {
  const group = useSearchStore((s) => s.selectedGlossGroup);

  const renderItem = useCallback(({ item }: { item: DictEntry }) => <EntryCard entry={item} />, []);

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">No group selected</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-xl font-bold text-foreground capitalize">{group.gloss}</Text>
      </View>
      <FlashList
        data={group.entries}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
      />
    </View>
  );
}
