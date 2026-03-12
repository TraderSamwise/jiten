import React from "react";
import { Stack } from "expo-router";
import { SafeBackButton, webHeaderStyle } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const backButton = ({ tintColor }: { tintColor?: string }) => (
  <SafeBackButton fallback="/lists" tintColor={tintColor} />
);

// Navigation perf pattern for heavy screens (study, typing-game, connect-game):
//
// FORWARD (source page → heavy screen):
// 1. Show inline spinner on the launch button (text + ActivityIndicator)
// 2. setTimeout(() => router.push(...), 100) to let the spinner paint
// 3. Reset loading state via useFocusEffect when user returns
// 4. Heavy screen exports a lightweight Shell component as default that
//    renders a spinner, then mounts the real component after setTimeout(100)
//    (see StudyScreenShell, GamesModal for examples)
//
// BACKWARD (heavy screen → source page):
// 1. setNavigating(true) to show a full-screen loading overlay (absolute inset-0)
// 2. setTimeout(() => goBack(), 100) so the heavy component unmounts off-screen
//
// Apply this to any new screen with complex UI or heavy data loading.
export default function ListsLayout() {
  return (
    <Stack screenOptions={{ headerLeft: backButton, headerStyle: webHeaderStyle }}>
      <Stack.Screen name="index" options={{ title: "Lists", headerLeft: () => null }} />
      <Stack.Screen name="[id]" options={{ title: "List" }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="kanji/[literal]" options={{ title: "Kanji" }} />
      <Stack.Screen name="counter/[counterId]" options={{ title: "Counter" }} />
      <Stack.Screen name="study" options={{ title: "Study", headerShown: false }} />
      <Stack.Screen name="typing-game" options={{ title: "Typing Game", headerShown: false }} />
      <Stack.Screen name="connect-game" options={{ title: "Connect Game", headerShown: false }} />
      <Stack.Screen name="stats" options={{ title: "Review Statistics", headerShown: false }} />
      <Stack.Screen
        name="marked-for-review"
        options={{ title: "Marked for Review", headerShown: false }}
      />
    </Stack>
  );
}
