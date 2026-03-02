import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import Svg, { Path, Defs, Filter, FeGaussianBlur } from "react-native-svg";

interface SwipeTrailProps {
  points: { x: number; y: number }[];
  width: number;
  height: number;
  isActive: boolean;
}

export function SwipeTrail({ points, width, height, isActive }: SwipeTrailProps) {
  const d = useMemo(() => {
    if (points.length < 2) return "";

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      path += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    path += ` L ${last.x} ${last.y}`;
    return path;
  }, [points]);

  if (!d) return null;

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <FeGaussianBlur stdDeviation="6" />
        </Filter>
      </Defs>
      {/* Glow layer */}
      <Path
        d={d}
        stroke={isActive ? "rgba(250, 204, 21, 0.4)" : "rgba(250, 204, 21, 0.1)"}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        filter="url(#glow)"
      />
      {/* Core trail */}
      <Path
        d={d}
        stroke={isActive ? "rgba(253, 224, 71, 0.9)" : "rgba(253, 224, 71, 0.3)"}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
