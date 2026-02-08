import { Stack } from "expo-router";

export default function DictionaryLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="word/[id]"
        options={{ title: "Word Detail", headerBackTitle: "Search" }}
      />
    </Stack>
  );
}
