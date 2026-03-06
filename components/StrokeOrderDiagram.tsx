import React, { useState, useCallback } from "react";
import { View, Pressable } from "react-native";
import Animated, { useAnimatedStyle, withTiming, FadeIn, FadeOut } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { useColorScheme } from "nativewind";
import type { StrokePath } from "@/db/types";

interface StrokeOrderDiagramProps {
  strokes: StrokePath[];
  /** Size of each frame. Defaults to 60. */
  size?: number;
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
export function StrokeOrderDiagram({ strokes, size = 60 }: StrokeOrderDiagramProps) {
  const { colorScheme } = useColorScheme();
  const [fullHeight, setFullHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const collapsedHeight = size + GAP + size * 0.5; // 1.5 rows
  const needsCollapse = fullHeight > size + GAP + 1; // more than one row

  // Match the Card component's background: --card is hsl(0,0%,100%) light, hsl(240,10%,3.9%) dark
  const cardBg = colorScheme === "dark" ? "rgb(9,9,11)" : "rgb(255,255,255)";
  const cardBgTransparent = colorScheme === "dark" ? "rgba(9,9,11,0)" : "rgba(255,255,255,0)";

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && h !== fullHeight) setFullHeight(h);
    },
    [fullHeight],
  );

  const animatedStyle = useAnimatedStyle(() => {
    if (!needsCollapse) return {};
    return {
      height: withTiming(expanded ? fullHeight : collapsedHeight, { duration: 250 }),
      overflow: "hidden" as const,
    };
  }, [expanded, fullHeight, collapsedHeight, needsCollapse]);

  if (strokes.length === 0) return null;

  const content = (
    <View className="flex-row flex-wrap gap-1" onLayout={onLayout}>
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

  if (!needsCollapse) return content;

  return (
    <Pressable onPress={() => setExpanded((v) => !v)}>
      <Animated.View style={animatedStyle}>{content}</Animated.View>
      {!expanded && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          pointerEvents="none"
        >
          <LinearGradient colors={[cardBgTransparent, cardBg]} style={{ height: size * 0.6 }} />
        </Animated.View>
      )}
    </Pressable>
  );
}
