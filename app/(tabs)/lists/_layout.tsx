import { Stack } from "expo-router";

export default function ListsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Lists" }} />
      <Stack.Screen name="[id]" options={{ title: "List" }} />
      <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="study" options={{ title: "Study", headerShown: false }} />
    </Stack>
  );
}
