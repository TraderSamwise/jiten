import React from "react";
import { View } from "react-native";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useTabRouter } from "@/lib/navigation";
import type { CounterEntry } from "@/db/types";

interface CounterCardProps {
  counter: CounterEntry;
}

export const CounterCard = React.memo(function CounterCard({ counter }: CounterCardProps) {
  const tabRouter = useTabRouter();

  return (
    <PressableCard className="mb-2" onPress={() => tabRouter.pushCounter(counter.counterId)}>
      <View className="flex-row items-center gap-2">
        <Text className="text-lg font-bold text-foreground">{counter.counterKanji}</Text>
        <Text className="text-sm text-muted-foreground">{counter.counterReading}</Text>
      </View>
      {counter.counterGloss && (
        <Text className="mt-0.5 text-sm text-muted-foreground" numberOfLines={1}>
          {counter.counterGloss}
        </Text>
      )}
    </PressableCard>
  );
});
