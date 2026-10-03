import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";

import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { ChevronRight, GraduationCap } from "@/lib/icons";
import { useRtkPath } from "@/hooks/useRtkPath";

/**
 * The Learn tab's root. Today it holds one course; it is a hub rather than the
 * RTK path itself so a second course is another card, not a rewrite.
 */
export default function LearnHome() {
  const router = useRouter();
  const { summary, unavailable } = useRtkPath();

  // Cast because expo-router's generated route union (.expo/types) only learns
  // about /learn once a dev server has regenerated it.
  const go = (path: string) => router.push(path as never);

  const next = summary?.next ?? null;
  const pct = summary && summary.possible > 0 ? (summary.earned / summary.possible) * 100 : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text className="text-sm text-muted-foreground">Courses that build your deck as you go.</Text>

      <PressableCard onPress={() => go("/learn/rtk")} className="mt-3 p-4">
        <View className="flex-row items-center">
          <GraduationCap size={22} className="text-primary" />
          <View className="ml-3 flex-1">
            <Text className="text-base font-semibold text-foreground">Remembering the Kanji</Text>
            <Text className="text-xs text-muted-foreground">
              Heisig volume 1 · 56 lessons · five frames at a time
            </Text>
          </View>
          <ChevronRight size={20} className="text-muted-foreground" />
        </View>

        {/* No summary yet means the first read is still in flight — the card
            still says what the course is, so nothing has to be hidden. */}
        {summary ? (
          <View className="mt-3">
            <View className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </View>
            <Text className="mt-1.5 text-xs text-muted-foreground">
              {summary.earned} of {summary.possible} crowns
            </Text>
          </View>
        ) : null}
      </PressableCard>

      {unavailable ? (
        <Text className="mt-3 text-sm text-muted-foreground">
          The course needs the dictionary to be downloaded.
        </Text>
      ) : next ? (
        <Pressable
          onPress={() => go(`/learn/node?unit=${next.unit}&node=${next.node}`)}
          className="mt-3 items-center rounded-xl bg-primary px-4 py-3 active:opacity-80"
        >
          <Text className="text-base font-semibold text-primary-foreground">Continue</Text>
          <Text className="text-xs text-primary-foreground/80">
            Lesson {next.unit} · node {next.node + 1}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
