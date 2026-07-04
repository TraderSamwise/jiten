import { Stack } from "expo-router";
import { DictionaryHeader } from "@/components/DictionaryHeader";

export { ErrorBoundary } from "@/components/ErrorBoundary";

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
      <Stack.Screen name="counter/[counterId]" />
      <Stack.Screen name="primitive/[id]" />
      <Stack.Screen name="gloss-group" />
    </Stack>
  );
}
