import { Stack } from "expo-router";
import { DictionaryHeader } from "@/components/DictionaryHeader";

export default function DictionaryLayout() {
  return (
    <Stack
      screenOptions={{
        header: (props) => <DictionaryHeader {...props} />,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="word/[id]" />
      <Stack.Screen name="kanji/[literal]" />
      <Stack.Screen name="gloss-group" />
    </Stack>
  );
}
