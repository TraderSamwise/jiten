import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { Text } from "@/components/ui/text";

const DEFAULT_BAR_WIDTH = 220;

export function getCatchUpDuration(previous: number, next: number): number {
  const delta = Math.max(0, next - previous);
  if (delta >= 0.3) return 360;
  if (delta >= 0.18) return 520;
  if (delta >= 0.1) return 720;
  return 960;
}

export function PhasedLoadingOverlay({
  visible,
  isDark,
  title,
  detail,
  progress,
}: {
  visible: boolean;
  isDark: boolean;
  title: string;
  detail: string;
  progress: number;
}) {
  const clampedProgress = Math.max(0, Math.min(progress, 1));
  const [barWidth, setBarWidth] = useState(DEFAULT_BAR_WIDTH);
  const progressRef = useRef(clampedProgress);
  const [fillTranslateX] = useState(
    () => new Animated.Value(-barWidth + barWidth * clampedProgress),
  );
  const [fadeAnimation] = useState(() => new Animated.Value(visible ? 1 : 0));
  const [translateYAnimation] = useState(() => new Animated.Value(visible ? 0 : 10));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnimation, {
        toValue: visible ? 1 : 0,
        duration: visible ? 320 : 220,
        easing: visible ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnimation, {
        toValue: visible ? 0 : 6,
        duration: visible ? 340 : 220,
        easing: visible ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnimation, translateYAnimation, visible]);

  useEffect(() => {
    const duration = getCatchUpDuration(progressRef.current, clampedProgress);
    progressRef.current = clampedProgress;
    Animated.timing(fillTranslateX, {
      toValue: -barWidth + barWidth * clampedProgress,
      duration,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [barWidth, clampedProgress, fillTranslateX]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="auto"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 300,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: isDark ? "rgba(24,24,27,0.92)" : "rgba(250,250,249,0.94)",
        paddingHorizontal: 24,
      }}
    >
      <View
        className="w-full max-w-[320px] rounded-2xl border border-border/60 px-4 py-4"
        style={{ backgroundColor: isDark ? "#111113" : "#ffffff" }}
      >
        <Animated.View
          style={{
            opacity: fadeAnimation,
            transform: [{ translateY: translateYAnimation }],
          }}
        >
          <Text className="text-base font-semibold text-foreground">{title}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">{detail}</Text>
          <View
            onLayout={(event) => {
              const nextWidth = Math.max(1, Math.round(event.nativeEvent.layout.width));
              setBarWidth((prev) => (prev === nextWidth ? prev : nextWidth));
            }}
            className="mt-4 h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: isDark ? "#27272a" : "#e7e5e4" }}
          >
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: barWidth,
                height: "100%",
                backgroundColor: isDark ? "#d6d3a3" : "#8a8450",
                borderRadius: 999,
                transform: [{ translateX: fillTranslateX }],
              }}
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
