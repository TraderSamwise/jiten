import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";

import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { loadUnitShapes } from "@/db/rtk-frames";
import { crownsFromProgress, loadCourseProgress } from "@/db/rtk-progress";
import { pathSummary, type PathSummary, type UnitShape } from "@/lib/rtk-course";

/**
 * The 56 unit shapes never change, so the path pays for them once per database.
 * Keyed by the db object, so reopening it re-reads; and the mini and full
 * dictionaries agree on the shape anyway (both 56 units, 2,200 frames).
 */
const shapeCache = new WeakMap<object, UnitShape[]>();

async function unitShapes(dictDb: Parameters<typeof loadUnitShapes>[0]): Promise<UnitShape[]> {
  const cached = shapeCache.get(dictDb);
  if (cached) return cached;
  const shapes = await loadUnitShapes(dictDb);
  shapeCache.set(dictDb, shapes);
  return shapes;
}

const DOT_BY_CROWN = [
  "bg-secondary border border-border",
  "bg-primary/30",
  "bg-primary/60",
  "bg-primary",
] as const;

function NodeDot({ crown, onPress }: { crown: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className={`h-6 w-6 rounded-md ${DOT_BY_CROWN[crown] ?? DOT_BY_CROWN[0]}`}
    />
  );
}

export default function LearnPath() {
  const { dictDb } = useDatabase();
  const userDb = useUserDb();
  const router = useRouter();
  const [summary, setSummary] = useState<PathSummary | null>(null);

  const refresh = useCallback(
    async (stillMounted: () => boolean = () => true) => {
      if (!dictDb || !userDb) return;
      const [shapes, progress] = await Promise.all([
        unitShapes(dictDb),
        loadCourseProgress(userDb),
      ]);
      // Filter before the summary, so the dots and Continue cannot disagree
      // about which units exist.
      const real = shapes.filter((shape) => shape.nodeCount > 0);
      if (stillMounted()) setSummary(pathSummary(real, crownsFromProgress(progress)));
    },
    [dictDb, userDb],
  );

  // The only load: a focus effect already runs on first focus, and crowns earned
  // inside a node have to show on the path the moment you come back.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      refresh(() => current).catch((err) => console.warn("[learn] could not load the path", err));
      return () => {
        current = false;
      };
    }, [refresh]),
  );

  // Cast because expo-router's generated route union (.expo/types) only learns
  // about /learn once a dev server has regenerated it.
  const openNode = (unit: number, node: number) =>
    router.push(`/learn/node?unit=${unit}&node=${node}` as never);

  // A missing dictionary is not a slow one: say so rather than spin forever.
  if (!dictDb || summary?.rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-base text-muted-foreground">
          The course needs the dictionary to be downloaded.
        </Text>
      </View>
    );
  }

  if (!summary) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const { next, rows: units } = summary;

  return (
    <FlashList
      data={units}
      keyExtractor={(row) => String(row.unit)}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ListHeaderComponent={
        <View>
          <Text className="text-2xl font-semibold text-foreground">Remembering the Kanji</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            {summary.earned} of {summary.possible} crowns · {units.length} lessons
          </Text>

          {next ? (
            <Pressable
              onPress={() => openNode(next.unit, next.node)}
              className="mt-4 items-center rounded-xl bg-primary px-4 py-3 active:opacity-80"
            >
              <Text className="text-base font-semibold text-primary-foreground">Continue</Text>
              <Text className="text-xs text-primary-foreground/80">
                Lesson {next.unit} · node {next.node + 1}
              </Text>
            </Pressable>
          ) : (
            <Card className="mt-4 p-4">
              <Text className="text-base font-semibold text-foreground">
                Every frame is crowned
              </Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                All 2,200 frames of volume 1, drilled to production.
              </Text>
            </Card>
          )}
        </View>
      }
      renderItem={({ item: row }) => (
        <Card className="mt-3 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">Lesson {row.unit}</Text>
            <Text className="text-xs text-muted-foreground">
              {row.earned}/{row.possible}
            </Text>
          </View>
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {row.crowns.map((crown, node) => (
              <NodeDot key={node} crown={crown} onPress={() => openNode(row.unit, node)} />
            ))}
          </View>
        </Card>
      )}
    />
  );
}
