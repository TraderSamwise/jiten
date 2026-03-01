import { useLocalSearchParams } from "expo-router";
import { KanjiDetail } from "@/components/KanjiDetail";

export default function ListsKanjiScreen() {
  const { literal } = useLocalSearchParams<{ literal: string }>();
  return <KanjiDetail literal={literal} />;
}
