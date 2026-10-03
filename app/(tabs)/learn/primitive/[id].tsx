import { useLocalSearchParams } from "expo-router";
import { PrimitiveDetail } from "@/components/PrimitiveDetail";

export default function LearnPrimitiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PrimitiveDetail primitiveId={Number(id)} />;
}
