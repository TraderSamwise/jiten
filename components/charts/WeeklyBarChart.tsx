import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import Svg, { Rect } from "react-native-svg";

interface WeeklyBarChartProps {
  data: { day: string; reviews: number; correct: number }[];
}

export function WeeklyBarChart({ data }: WeeklyBarChartProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dataMap = new Map(data.map((d) => [d.day, d]));

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const days: { day: string; label: string; reviews: number; correct: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const entry = dataMap.get(dayStr);
    days.push({
      day: dayStr,
      label: dayLabels[d.getDay()],
      reviews: entry?.reviews ?? 0,
      correct: entry?.correct ?? 0,
    });
  }

  const maxReviews = Math.max(1, ...days.map((d) => d.reviews));
  const barWidth = 28;
  const barGap = 8;
  const chartHeight = 100;
  const svgWidth = days.length * (barWidth + barGap) - barGap;

  return (
    <View className="items-center">
      <Svg width={svgWidth} height={chartHeight}>
        {days.map((d, i) => {
          const x = i * (barWidth + barGap);
          const totalH = (d.reviews / maxReviews) * (chartHeight - 4);
          const correctH = d.reviews > 0 ? (d.correct / d.reviews) * totalH : 0;
          const incorrectH = totalH - correctH;
          return (
            <React.Fragment key={d.day}>
              {/* Incorrect portion (top) */}
              <Rect
                x={x}
                y={chartHeight - totalH}
                width={barWidth}
                height={incorrectH}
                rx={2}
                fill="#ef4444"
              />
              {/* Correct portion (bottom) */}
              <Rect
                x={x}
                y={chartHeight - correctH}
                width={barWidth}
                height={correctH}
                rx={2}
                fill="#22c55e"
              />
            </React.Fragment>
          );
        })}
      </Svg>
      <View className="flex-row mt-1" style={{ width: svgWidth }}>
        {days.map((d, i) => (
          <Text
            key={d.day}
            className="text-xs text-muted-foreground text-center"
            style={{ width: barWidth + (i < days.length - 1 ? barGap : 0) }}
          >
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
