import React, { useEffect, useState } from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { EntryCard } from "@/components/EntryCard";
import { useDatabase } from "@/db/provider";
import { useTabRouter } from "@/lib/navigation";
import { getCounter, getNounsForCounter } from "@/db/counter-search";
import { getEntries } from "@/db/search";
import type { CounterEntry, DictEntry } from "@/db/types";

function isKanji(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

interface CounterDetailProps {
  counterId: number;
}

export function CounterDetail({ counterId }: CounterDetailProps) {
  const { dictDb, extendedDb, isReady } = useDatabase();
  const tabRouter = useTabRouter();
  const [counter, setCounter] = useState<CounterEntry | null>(null);
  const [words, setWords] = useState<DictEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!extendedDb || !isReady) return;

    setLoading(true);
    getCounter(extendedDb, counterId)
      .then(setCounter)
      .catch(() => {})
      .finally(() => setLoading(false));

    if (dictDb) {
      getNounsForCounter(extendedDb, counterId)
        .then((ids) => (ids.length > 0 ? getEntries(dictDb, ids) : []))
        .then(setWords)
        .catch(() => {});
    }
  }, [extendedDb, dictDb, isReady, counterId]);

  if (loading || !counter) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background px-4 pt-4">
      {/* Header */}
      <View className="mb-4 items-center">
        <Text className="text-4xl font-bold text-foreground">
          {[...counter.counterKanji].map((ch, i) =>
            isKanji(ch.codePointAt(0)!) ? (
              <Text
                key={i}
                className="text-4xl font-bold text-foreground"
                onPress={() => tabRouter.pushKanji(ch)}
              >
                {ch}
              </Text>
            ) : (
              ch
            ),
          )}
        </Text>
        <Text className="mt-1 text-lg text-muted-foreground">{counter.counterReading}</Text>
        {counter.counterGloss && (
          <Text className="mt-1 text-center text-sm text-muted-foreground">
            {counter.counterGloss}
          </Text>
        )}
      </View>

      {/* Readings grid */}
      <Card className="mb-4">
        <Text className="text-sm font-medium text-muted-foreground mb-2">Readings</Text>
        {counter.readings.map((r) => (
          <View
            key={r.number}
            className="flex-row items-center py-2 border-b border-border/30 last:border-b-0"
          >
            <Text className="w-10 text-base text-muted-foreground">
              {r.number === "何" ? "何" : r.number}
            </Text>
            <Text className="w-20 text-lg font-medium text-foreground">{r.combinedKanji}</Text>
            <Text className="flex-1 text-base text-foreground">{r.reading}</Text>
          </View>
        ))}
      </Card>

      {/* Nouns that use this counter */}
      {words.length > 0 && (
        <View className="mb-6">
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Words counted with {counter.counterKanji}
          </Text>
          {words.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
