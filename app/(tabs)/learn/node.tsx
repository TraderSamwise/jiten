import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { loadNodeFrames } from "@/db/rtk-frames";
import { markNodeSeen } from "@/db/rtk-progress";
import { useTabRouter } from "@/lib/navigation";
import { nodeRefFromParams, type CourseFrame } from "@/lib/rtk-course";

export default function LearnNodeScreen() {
  const { unit, node } = useLocalSearchParams<{ unit?: string; node?: string }>();
  const { dictDb } = useDatabase();
  const userDb = useUserDb();
  const tabRouter = useTabRouter();
  const [frames, setFrames] = useState<CourseFrame[] | null>(null);

  const ref = useMemo(() => nodeRefFromParams(unit, node), [unit, node]);

  useEffect(() => {
    if (!ref || !dictDb) return;
    let current = true;
    // Clear first, so a param change cannot drill one node against another's frames.
    setFrames(null);
    loadNodeFrames(dictDb, ref)
      .then((loaded) => {
        if (current) setFrames(loaded);
      })
      .catch((err) => {
        if (current) setFrames([]);
        console.warn("[learn] could not load the node", err);
      });
    return () => {
      current = false;
    };
  }, [dictDb, ref]);

  // Only once the node is known to exist: a link naming a node the course does
  // not have must not leave a synced progress row behind.
  useEffect(() => {
    if (!ref || !userDb || !frames?.length) return;
    markNodeSeen(userDb, ref).catch((err) =>
      console.warn("[learn] could not record the node as seen", err),
    );
  }, [userDb, ref, frames?.length]);

  if (!ref) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-base text-muted-foreground">That is not a node of the course.</Text>
      </View>
    );
  }

  if (!frames) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (frames.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-base text-muted-foreground">
          Lesson {ref.unit} has no node {ref.node + 1}.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text className="text-sm text-muted-foreground">
        Lesson {ref.unit} · node {ref.node + 1} · frames {frames[0].index}–
        {frames[frames.length - 1].index}
      </Text>

      {frames.map((frame) => (
        <Pressable key={frame.literal} onPress={() => tabRouter.pushKanji(frame.literal)}>
          <Card className="mt-3 flex-row items-center gap-4 p-4">
            <Text className="text-4xl text-foreground">{frame.literal}</Text>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">{frame.keyword}</Text>
              <Text className="text-xs text-muted-foreground">Frame {frame.index}</Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
