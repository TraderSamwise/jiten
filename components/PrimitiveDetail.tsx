import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { PrimitiveGlyph } from "@/components/PrimitiveGlyph";
import { useDatabase } from "@/db/provider";
import { useTabRouter } from "@/lib/navigation";
import {
  getPrimitiveAsync,
  getKanjiUsingPrimitiveAsync,
  getKanjiBatchAsync,
} from "@/db/kanji-search";
import type { Primitive, KanjiCharacter } from "@/db/types";

interface PrimitiveDetailProps {
  primitiveId: number;
}

type Status = "loading" | "no-tier" | "not-found" | "ready";

/** Sort kanji by Heisig index (nulls last), then frequency rank (nulls last). */
function byHeisigThenFrequency(a: KanjiCharacter, b: KanjiCharacter): number {
  const ha = a.heisigIndex ?? Number.MAX_SAFE_INTEGER;
  const hb = b.heisigIndex ?? Number.MAX_SAFE_INTEGER;
  if (ha !== hb) return ha - hb;
  const fa = a.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const fb = b.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  return fa - fb;
}

export function PrimitiveDetail({ primitiveId }: PrimitiveDetailProps) {
  const { dictDb, strokesDb, isReady } = useDatabase();
  const tabRouter = useTabRouter();
  const [primitive, setPrimitive] = useState<Primitive | null>(null);
  const [kanji, setKanji] = useState<KanjiCharacter[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!isReady) return;
    // The strokes tier carries the primitive tables; it downloads in the background.
    if (!strokesDb) {
      setStatus("no-tier");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    getPrimitiveAsync(strokesDb, primitiveId)
      .then(async (prim) => {
        if (cancelled) return;
        if (!prim) {
          setStatus("not-found");
          return;
        }
        setPrimitive(prim);
        try {
          const literals = await getKanjiUsingPrimitiveAsync(strokesDb, primitiveId);
          if (cancelled) return;
          const list =
            dictDb && literals.length > 0 ? await getKanjiBatchAsync(dictDb, literals) : [];
          if (cancelled) return;
          setKanji(list.sort(byHeisigThenFrequency));
        } catch {
          // Reverse-index/batch hiccup: still show the primitive, just no "appears in" list.
        }
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [strokesDb, dictDb, isReady, primitiveId]);

  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "no-tier") {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-base text-muted-foreground">
          Primitive data is still downloading. Check back once the kanji data finishes syncing.
        </Text>
      </View>
    );
  }

  if (status === "not-found" || !primitive) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-base text-muted-foreground">Primitive not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background px-4 pt-4">
      {/* Hero: the primitive's shape (real glyph, or RTK-font substitute) over its keyword. */}
      <View className="mb-4 items-center">
        <PrimitiveGlyph
          glyph={primitive.realGlyph}
          displayGlyph={primitive.displayGlyph}
          className="mb-1 text-6xl font-bold text-foreground"
        />
        <Text className="text-3xl font-bold text-foreground">
          {primitive.keyword ?? "Primitive"}
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Text className="text-sm text-muted-foreground">primitive element</Text>
          {primitive.strokes != null && (
            <Text className="text-sm text-muted-foreground">· {primitive.strokes} strokes</Text>
          )}
        </View>
      </View>

      {kanji.length > 0 && (
        <Card className="mb-3">
          <Text className="mb-2 text-sm font-medium text-muted-foreground">
            Appears in {kanji.length} kanji
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {kanji.map((k) => (
              <Pressable
                key={k.literal}
                onPress={() => tabRouter.pushKanji(k.literal)}
                className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
              >
                <Text className="text-xl font-bold text-foreground">{k.literal}</Text>
                {k.heisigKeyword && (
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {k.heisigKeyword}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
