import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import type { CounterEntry } from "@/db/types";

interface CounterCardProps {
  counter: CounterEntry;
}

export const CounterCard = React.memo(function CounterCard({ counter }: CounterCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="mb-2">
      <Pressable onPress={() => setExpanded(!expanded)} className="active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-bold text-foreground">{counter.counterKanji}</Text>
          <Text className="text-sm text-muted-foreground">{counter.counterReading}</Text>
        </View>
        {counter.counterGloss && (
          <Text className="mt-0.5 text-sm text-muted-foreground" numberOfLines={expanded ? 0 : 1}>
            {counter.counterGloss}
          </Text>
        )}
      </Pressable>

      {expanded && (
        <View className="mt-3 rounded-lg bg-secondary/50 px-3 py-2">
          {counter.readings.map((r) => (
            <View
              key={r.number}
              className="flex-row items-center py-1.5 border-b border-border/30 last:border-b-0"
            >
              <Text className="w-8 text-sm text-muted-foreground">
                {r.number === "何" ? "何" : r.number}
              </Text>
              <Text className="w-16 text-base font-medium text-foreground">{r.combinedKanji}</Text>
              <Text className="flex-1 text-base text-foreground">{r.reading}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
});
