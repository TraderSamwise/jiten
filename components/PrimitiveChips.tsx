import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import type { KanjiPrimitive } from "@/db/types";

interface PrimitiveChipsProps {
  primitives: KanjiPrimitive[];
  className?: string;
}

/**
 * Read-only row of a kanji's RTK primitive elements. Non-interactive by design:
 * used on flashcards where a tap would disrupt the study session.
 */
export function PrimitiveChips({ primitives, className }: PrimitiveChipsProps) {
  const renderable = primitives.filter((p) => p.glyph != null || p.keyword != null);
  if (renderable.length === 0) return null;

  return (
    <View className={`flex-row flex-wrap justify-center gap-1.5 ${className ?? ""}`}>
      {renderable.map((p) => (
        <View
          key={p.position}
          className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-0.5"
        >
          {p.glyph != null && <Text className="text-sm font-bold text-foreground">{p.glyph}</Text>}
          {p.keyword != null && <Text className="text-xs text-muted-foreground">{p.keyword}</Text>}
        </View>
      ))}
    </View>
  );
}
