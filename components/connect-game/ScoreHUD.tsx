import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import type { GameState } from "@/lib/connect-game/types";
import { getComboMultiplier } from "@/lib/connect-game/scoring";

interface ScoreHUDProps {
  state: GameState;
}

export function ScoreHUD({ state }: ScoreHUDProps) {
  const comboScale = useSharedValue(1);
  const scoreScale = useSharedValue(1);

  useEffect(() => {
    if (state.combo > 0) {
      comboScale.value = withSequence(
        withTiming(1.4, { duration: 100 }),
        withTiming(1, { duration: 200 }),
      );
    }
  }, [state.combo, comboScale]);

  useEffect(() => {
    scoreScale.value = withSequence(
      withTiming(1.15, { duration: 80 }),
      withTiming(1, { duration: 150 }),
    );
  }, [state.score, scoreScale]);

  const comboStyle = useAnimatedStyle(() => ({
    transform: [{ scale: comboScale.value }],
  }));

  const scoreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scoreScale.value }],
  }));

  const multiplier = getComboMultiplier(state.combo);
  const timeSeconds = Math.ceil(state.timeRemaining / 1000);
  const minutes = Math.floor(timeSeconds / 60);
  const seconds = timeSeconds % 60;

  return (
    <View className="flex-row items-center justify-between px-4 py-2">
      {/* Score */}
      <Animated.View style={scoreStyle}>
        <Text className="text-2xl font-bold text-foreground">{state.score}</Text>
      </Animated.View>

      {/* Combo */}
      <View className="items-center">
        {state.combo > 0 && (
          <Animated.View style={comboStyle}>
            <Text className="text-lg font-bold text-yellow-400">x{multiplier}</Text>
          </Animated.View>
        )}
        <Text className="text-xs text-muted-foreground">Wave {state.wave}</Text>
      </View>

      {/* Timer / Lives */}
      <View className="items-end">
        {state.mode === "timed" && (
          <Text
            className={`text-xl font-bold ${timeSeconds <= 10 ? "text-red-400" : "text-foreground"}`}
          >
            {minutes}:{seconds.toString().padStart(2, "0")}
          </Text>
        )}
        {state.mode === "survival" && (
          <View className="flex-row gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <Text
                key={i}
                className={`text-lg ${i < state.lives ? "text-red-400" : "text-muted-foreground/30"}`}
              >
                {i < state.lives ? "\u2764" : "\u2661"}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
