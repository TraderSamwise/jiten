import React from "react";
import { Stack } from "expo-router";
import { SafeBackButton, webHeaderStyle } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const backButton = ({ tintColor }: { tintColor?: string }) => (
  <SafeBackButton fallback="/learn" tintColor={tintColor} />
);

export default function LearnLayout() {
  return (
    <Stack screenOptions={{ headerLeft: backButton, headerStyle: webHeaderStyle }}>
      <Stack.Screen name="index" options={{ title: "Learn", headerLeft: () => null }} />
      <Stack.Screen name="rtk" options={{ title: "Remembering the Kanji" }} />
      <Stack.Screen name="node" options={{ title: "Node", headerShown: false }} />
      <Stack.Screen name="study" options={{ title: "Review", headerShown: false }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="kanji/[literal]" options={{ title: "Kanji" }} />
      <Stack.Screen name="counter/[counterId]" options={{ title: "Counter" }} />
      <Stack.Screen name="primitive/[id]" options={{ title: "Primitive" }} />
    </Stack>
  );
}
