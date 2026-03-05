import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
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
  const scale = useSharedValue(0.3);

  useEffect(() => {
    // Punch in big then settle
    scale.value = withSequence(
      withTiming(1.5, { duration: 100, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
    );
    // Float up
    translateY.value = withTiming(-70, { duration: 900, easing: Easing.out(Easing.quad) });
    // Hold fully visible then fade
    opacity.value = withSequence(
      withTiming(1, { duration: 450 }),
      withTiming(0, { duration: 450 }, () => {
        runOnJS(onDone)();
      }),
    );
  }, [translateY, opacity, scale, onDone]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  const isTriple = match.type === "triple";
  const label = isTriple ? "TRIPLE!" : "MATCH!";
  const bg = isTriple ? "#b45309" : "#15803d";
  const border = isTriple ? "#fbbf24" : "#4ade80";

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: x - 75,
          top: y - 28,
          width: 150,
          zIndex: 100,
          alignItems: "center",
        },
        style,
      ]}
      pointerEvents="none"
    >
      <View
        style={{
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: border,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center" }}>
          {label}
        </Text>
        <Text style={{ color: "#fef08a", fontSize: 16, fontWeight: "700", textAlign: "center" }}>
          +{match.totalPoints}
        </Text>
        {match.speedBonus > 0 && (
          <Text style={{ color: "#a5f3fc", fontSize: 13, fontWeight: "600", textAlign: "center" }}>
            SPEED +{match.speedBonus}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}
