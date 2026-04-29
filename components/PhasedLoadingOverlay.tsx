import React, { useEffect, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { Text } from "@/components/ui/text";

function getStepPercent(step: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  const clampedStep = Math.max(0, Math.min(step, totalSteps));
  return (clampedStep / totalSteps) * 100;
}

export function PhasedLoadingOverlay({
  visible,
  isDark,
  title,
  detail,
  currentStep,
  totalSteps,
  stepDurationMs,
}: {
  visible: boolean;
  isDark: boolean;
  title: string;
  detail: string;
  currentStep: number;
  totalSteps: number;
  stepDurationMs: number;
}) {
  const [trackWidth, setTrackWidth] = useState(220);
  const startPercent = getStepPercent(Math.max(0, currentStep - 1), totalSteps);
  const endPercent = getStepPercent(currentStep, totalSteps);
  const startPosition = -trackWidth + (trackWidth * startPercent) / 100;
  const endPosition = -trackWidth + (trackWidth * endPercent) / 100;

  const [slideAnimation] = useState(() => new Animated.Value(startPosition));
  const [fadeAnimation] = useState(() => new Animated.Value(0));
  const [translateYAnimation] = useState(() => new Animated.Value(10));

  useEffect(() => {
    if (!visible) return;

    slideAnimation.setValue(startPosition);

    const animation = Animated.parallel([
      Animated.timing(fadeAnimation, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnimation, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnimation, {
        toValue: endPosition,
        duration: stepDurationMs,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [
    visible,
    stepDurationMs,
    startPosition,
    endPosition,
    slideAnimation,
    fadeAnimation,
    translateYAnimation,
  ]);

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
        paddingTop: "33%",
      }}
    >
      <Animated.View
        style={{
          alignItems: "center",
          padding: 20,
          minWidth: 240,
          marginTop: -3,
          opacity: fadeAnimation,
          transform: [{ translateY: translateYAnimation }],
        }}
      >
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Text className="mt-1 text-center text-sm text-muted-foreground">{detail}</Text>

        <View
          onLayout={(event) => {
            const nextWidth = Math.max(1, Math.round(event.nativeEvent.layout.width));
            setTrackWidth((prev) => (prev === nextWidth ? prev : nextWidth));
          }}
          style={{
            width: trackWidth,
            height: 6,
            marginTop: 16,
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              borderRadius: 3,
              backgroundColor: isDark ? "#27272a" : "#e7e5e4",
            }}
          />
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: trackWidth,
              height: "100%",
              backgroundColor: isDark ? "#d6d3a3" : "#8a8450",
              borderRadius: 3,
              transform: [{ translateX: slideAnimation }],
            }}
          />
        </View>
      </Animated.View>
    </View>
  );
}
