import React from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

interface HeatmapProps {
  data: { day: string; count: number }[];
  days?: number;
  onDayPress?: (day: string) => void;
  selectedDay?: string | null;
}

export function Heatmap({ data, days = 90, onDayPress, selectedDay }: HeatmapProps) {
  const countMap = new Map(data.map((d) => [d.day, d.count]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  const maxCount = Math.max(1, ...data.map((d) => d.count));

  const cellSize = 12;
  const gap = 2;
  const step = cellSize + gap;

  const startDow = dates[0].getDay(); // 0=Sun
  const totalCells = startDow + dates.length;
  const numWeeks = Math.ceil(totalCells / 7);

  const getColor = (count: number): string => {
    if (count === 0) return "#1f1f23";
    const intensity = Math.min(count / maxCount, 1);
    if (intensity < 0.25) return "#0e4429";
    if (intensity < 0.5) return "#006d32";
    if (intensity < 0.75) return "#26a641";
    return "#39d353";
  };

  const svgWidth = numWeeks * step;
  const svgHeight = 7 * step;

  return (
    <View>
      <Svg width={svgWidth} height={svgHeight}>
        {dates.map((date, i) => {
          const dayStr = date.toISOString().slice(0, 10);
          const count = countMap.get(dayStr) ?? 0;
          const col = Math.floor((i + startDow) / 7);
          const row = (i + startDow) % 7;
          const isSelected = selectedDay === dayStr;
          return (
            <Rect
              key={dayStr}
              x={col * step}
              y={row * step}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={getColor(count)}
              onPress={onDayPress ? () => onDayPress(dayStr) : undefined}
              stroke={isSelected ? "#ffffff" : undefined}
              strokeWidth={isSelected ? 1.5 : 0}
            />
          );
        })}
      </Svg>
    </View>
  );
}
