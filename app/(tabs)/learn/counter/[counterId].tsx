import { useLocalSearchParams } from "expo-router";
import { CounterDetail } from "@/components/CounterDetail";

export default function LearnCounterScreen() {
  const { counterId } = useLocalSearchParams<{ counterId: string }>();
  return <CounterDetail counterId={Number(counterId)} />;
}
