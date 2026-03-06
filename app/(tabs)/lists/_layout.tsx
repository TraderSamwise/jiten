import React from "react";
import { Stack } from "expo-router";
import { SafeBackButton } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const backButton = ({ tintColor }: { tintColor?: string }) => (
  <SafeBackButton fallback="/lists" tintColor={tintColor} />
);

// Navigation perf pattern for heavy screens (study, typing-game, connect-game):
// - Forward: defer DB work with InteractionManager.runAfterInteractions()
// - Backward: show a full-screen loading overlay, then setTimeout(goBack, 100)
//   so the heavy component unmounts off-screen and doesn't jank the animation.
// Apply this to any new screen with complex UI or heavy data loading.
export default function ListsLayout() {
  return (
    <Stack screenOptions={{ headerLeft: backButton }}>
      <Stack.Screen name="index" options={{ title: "Lists", headerLeft: () => null }} />
      <Stack.Screen name="[id]" options={{ title: "List" }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="kanji/[literal]" options={{ title: "Kanji" }} />
      <Stack.Screen name="study" options={{ title: "Study", headerShown: false }} />
      <Stack.Screen name="typing-game" options={{ title: "Typing Game", headerShown: false }} />
      <Stack.Screen name="connect-game" options={{ title: "Connect Game", headerShown: false }} />
    </Stack>
  );
}
