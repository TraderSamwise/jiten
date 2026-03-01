import React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import type { ConfusionCluster } from "@/lib/practice-stats";
import type { DictEntry } from "@/db/types";

interface ConfusionClustersProps {
  clusters: ConfusionCluster[];
  entries: Map<number, DictEntry>;
  onPressEntry: (entryId: number) => void;
  onPressKanji: (literal: string) => void;
}

function confusionTypeLabel(type: string): string {
  switch (type) {
    case "visual_kanji":
      return "visual";
    case "reading":
      return "reading";
    case "meaning":
      return "meaning";
    default:
      return type;
  }
}

function getDisplay(
  entryId: number,
  kanjiLiteral: string | null,
  entries: Map<number, DictEntry>,
): string {
  if (kanjiLiteral) return kanjiLiteral;
  const entry = entries.get(entryId);
  if (entry) {
    return entry.kanji[0]?.text || entry.kana[0]?.text || `#${entryId}`;
  }
  return `#${entryId}`;
}

export function ConfusionClusters({
  clusters,
  entries,
  onPressEntry,
  onPressKanji,
}: ConfusionClustersProps) {
  if (clusters.length === 0) return null;

  return (
    <View className="gap-3">
      {clusters.slice(0, 5).map((cluster, idx) => (
        <View key={idx} className="gap-2">
          <Text className="text-xs text-muted-foreground">
            {cluster.entries.length} words · confused {cluster.totalConfusions}x
          </Text>

          {/* Word pills */}
          <View className="flex-row flex-wrap gap-1.5">
            {cluster.entries.map((entry) => {
              const display = getDisplay(entry.entryId, entry.kanjiLiteral, entries);
              return (
                <Pressable
                  key={`${entry.entryId}-${entry.kanjiLiteral}`}
                  className="bg-muted px-2.5 py-1 rounded-lg"
                  onPress={() => {
                    if (entry.kanjiLiteral) onPressKanji(entry.kanjiLiteral);
                    else onPressEntry(entry.entryId);
                  }}
                >
                  <Text className="text-sm font-medium text-foreground">{display}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Pair edges */}
          <View className="gap-0.5">
            {cluster.pairs.map((pair, pIdx) => {
              const displayA = getDisplay(pair.entryIdA, pair.kanjiLiteralA, entries);
              const displayB = getDisplay(pair.entryIdB, pair.kanjiLiteralB, entries);
              return (
                <Text key={pIdx} className="text-xs text-muted-foreground">
                  {displayA} ↔ {displayB} ({pair.confusionCount}x,{" "}
                  {confusionTypeLabel(pair.confusionType)})
                </Text>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
