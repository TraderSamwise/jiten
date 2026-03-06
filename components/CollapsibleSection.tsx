import React, { useState, useCallback } from "react";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle, withTiming, FadeIn, FadeOut } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";

interface CollapsibleSectionProps {
  /** Height at which content is considered overflowing. */
  collapsedHeight: number;
  /** Height of the fade gradient overlay. Defaults to 30. */
  fadeHeight?: number;
  children: React.ReactNode;
}

/**
 * Wraps content and collapses it to `collapsedHeight` if it overflows.
 * Shows a gradient fade at the bottom when collapsed.
 * Tap to expand/collapse with animation.
 * If content fits within collapsedHeight, renders normally with no collapse.
 */
export function CollapsibleSection({
  collapsedHeight,
  fadeHeight = 30,
  children,
}: CollapsibleSectionProps) {
  const { colorScheme } = useColorScheme();
  const [fullHeight, setFullHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const needsCollapse = fullHeight > collapsedHeight + 1;

  // Match --card: hsl(0,0%,100%) light, hsl(240,10%,3.9%) dark
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

  const inner = <Animated.View onLayout={onLayout}>{children}</Animated.View>;

  if (!needsCollapse) return inner;

  return (
    <Pressable onPress={() => setExpanded((v) => !v)}>
      <Animated.View style={animatedStyle}>{inner}</Animated.View>
      {!expanded && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          pointerEvents="none"
        >
          <LinearGradient colors={[cardBgTransparent, cardBg]} style={{ height: fadeHeight }} />
        </Animated.View>
      )}
    </Pressable>
  );
}
