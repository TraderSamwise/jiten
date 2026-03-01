import React from "react";
import { Stack } from "expo-router";
import { SafeBackButton } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const backButton = ({ tintColor }: { tintColor?: string }) => (
  <SafeBackButton fallback="/lists" tintColor={tintColor} />
);

export default function ListsLayout() {
  return (
    <Stack screenOptions={{ headerLeft: backButton }}>
      <Stack.Screen name="index" options={{ title: "Lists", headerLeft: () => null }} />
      <Stack.Screen name="[id]" options={{ title: "List" }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="kanji/[literal]" options={{ title: "Kanji" }} />
      <Stack.Screen name="study" options={{ title: "Study", headerShown: false }} />
      <Stack.Screen name="typing-game" options={{ title: "Typing Game", headerShown: false }} />
    </Stack>
  );
}
