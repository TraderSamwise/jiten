import { useLocalSearchParams } from "expo-router";
import { KanjiDetail } from "@/components/KanjiDetail";

export default function LearnKanjiScreen() {
  const { literal } = useLocalSearchParams<{ literal: string }>();
  return <KanjiDetail literal={literal} />;
}
