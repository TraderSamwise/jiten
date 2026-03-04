import React from "react";
import { View } from "react-native";

/** Simple single-value progress bar. */
export function ProgressBar({
  percent,
  color = "bg-green-600",
}: {
  percent: number;
  color?: string;
}) {
  if (percent <= 0) return null;
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <View className="mt-2 h-1.5 flex-row rounded-full overflow-hidden bg-muted">
      <View className={color} style={{ width: `${clamped}%` }} />
    </View>
  );
}

/** Multi-segment progress bar for SRS study progress. */
export function StudyProgressBar({
  learned,
  learning,
  total,
}: {
  learned: number;
  learning: number;
  total: number;
}) {
  if (total <= 0) return null;
  const learnedPct = (learned / total) * 100;
  const learningPct = (learning / total) * 100;
  if (learnedPct <= 0 && learningPct <= 0) return null;

  return (
    <View className="mt-2 h-1.5 flex-row rounded-full overflow-hidden bg-muted">
      {learnedPct > 0 && <View className="bg-green-600" style={{ width: `${learnedPct}%` }} />}
      {learningPct > 0 && <View className="bg-yellow-500" style={{ width: `${learningPct}%` }} />}
    </View>
  );
}
