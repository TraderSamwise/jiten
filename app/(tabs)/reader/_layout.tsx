import { Stack } from "expo-router";

export { ErrorBoundary } from "@/components/ErrorBoundary";

export default function ReaderLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Library" }} />
      <Stack.Screen name="browse" options={{ title: "Browse Aozora" }} />
      <Stack.Screen name="browse-syosetu" options={{ title: "Browse Syosetu" }} />
      <Stack.Screen name="novel-syosetu" options={{ title: "Chapters" }} />
      <Stack.Screen name="[bookId]" options={{ title: "Reader", headerShown: false }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
    </Stack>
  );
}
