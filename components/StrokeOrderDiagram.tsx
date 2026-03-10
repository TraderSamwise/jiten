import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import type { StrokePath } from "@/db/types";

interface StrokeOrderDiagramProps {
  strokes: StrokePath[];
  /** Size of each frame. Defaults to 60. */
  size?: number;
  /** Optional header rendered above the collapsible content. */
  header?: React.ReactNode;
}

const GAP = 4; // gap-1 = 4px

/**
 * Progressive stroke order diagram.
 * Each frame shows all previous strokes in gray and the current stroke highlighted.
 * SVG paths use a 109x109 viewBox (KanjiVG standard).
 *
 * When content overflows one row, collapses to ~1.5 rows with a fade overlay.
 * Tap to expand/collapse with animation.
 */
export function StrokeOrderDiagram({ strokes, size = 60, header }: StrokeOrderDiagramProps) {
  if (strokes.length === 0) return null;

  return (
    <CollapsibleSection
      collapsedHeight={size + GAP + size * 0.5}
      fadeHeight={size * 0.6}
      header={header}
    >
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
    </CollapsibleSection>
  );
}
