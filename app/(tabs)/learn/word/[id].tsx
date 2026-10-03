import { useLocalSearchParams } from "expo-router";
import { WordDetail } from "@/components/WordDetail";

export default function LearnWordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WordDetail entryId={Number(id)} />;
}
