import React, { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import type { MatchResult } from "@/lib/connect-game/types";

interface MatchFlashProps {
  match: MatchResult;
  x: number;
  y: number;
  onDone: () => void;
}

export function MatchFlash({ match, x, y, onDone }: MatchFlashProps) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.2, { duration: 150 }),
      withTiming(1, { duration: 100 }),
    );
    translateY.value = withTiming(-60, { duration: 1200 });
    opacity.value = withTiming(0, { duration: 1200 }, () => {
      runOnJS(onDone)();
    });
  }, [translateY, opacity, scale, onDone]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  const color = match.type === "triple" ? "text-yellow-300" : "text-green-300";
  const label = match.type === "triple" ? "TRIPLE!" : "MATCH!";

  return (
    <Animated.View
      style={[{ position: "absolute", left: x - 50, top: y - 20, width: 100, zIndex: 100 }, style]}
      pointerEvents="none"
    >
      <Text className={`text-center font-bold text-lg ${color}`}>{label}</Text>
      <Text className="text-center font-semibold text-sm text-yellow-200">
        +{match.totalPoints}
      </Text>
      {match.speedBonus > 0 && (
        <Text className="text-center text-xs text-cyan-300">SPEED +{match.speedBonus}</Text>
      )}
    </Animated.View>
  );
}
