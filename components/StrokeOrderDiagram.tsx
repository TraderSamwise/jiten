import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { StrokePath } from "@/db/types";

interface StrokeOrderDiagramProps {
  strokes: StrokePath[];
  /** Size of each frame. Defaults to 60. */
  size?: number;
}

/**
 * Progressive stroke order diagram.
 * Each frame shows all previous strokes in gray and the current stroke highlighted.
 * SVG paths use a 109x109 viewBox (KanjiVG standard).
 */
export function StrokeOrderDiagram({ strokes, size = 60 }: StrokeOrderDiagramProps) {
  if (strokes.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-1">
      {strokes.map((_, stepIndex) => (
        <View
          key={stepIndex}
          className="rounded bg-secondary"
          style={{ width: size, height: size }}
        >
          <Svg width={size} height={size} viewBox="0 0 109 109">
            {strokes.slice(0, stepIndex + 1).map((stroke, i) => (
              <Path
                key={i}
                d={stroke.d}
                fill="none"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                stroke={i === stepIndex ? "#ef4444" : "#a1a1aa"}
                opacity={i === stepIndex ? 1 : 0.4}
              />
            ))}
          </Svg>
        </View>
      ))}
    </View>
  );
}
