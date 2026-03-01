import React from "react";
import { Stack } from "expo-router";
import { SafeBackButton } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const backButton = ({ tintColor }: { tintColor?: string }) => (
  <SafeBackButton fallback="/reader" tintColor={tintColor} />
);

export default function ReaderLayout() {
  return (
    <Stack screenOptions={{ headerLeft: backButton }}>
      <Stack.Screen name="index" options={{ title: "Library", headerLeft: () => null }} />
      <Stack.Screen name="browse" options={{ title: "Browse Aozora" }} />
      <Stack.Screen name="browse-syosetu" options={{ title: "Browse Syosetu" }} />
      <Stack.Screen name="novel-syosetu" options={{ title: "Chapters" }} />
      <Stack.Screen name="[bookId]" options={{ title: "Reader", headerShown: false }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="kanji/[literal]" options={{ title: "Kanji" }} />
    </Stack>
  );
}
