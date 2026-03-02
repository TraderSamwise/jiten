import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import type { GameState } from "@/lib/connect-game/types";

interface GameOverScreenProps {
  state: GameState;
  endedAt: number;
  onPlayAgain: () => void;
  onReturn: () => void;
}

export function GameOverScreen({ state, endedAt, onPlayAgain, onReturn }: GameOverScreenProps) {
  const durationMs = endedAt - state.startedAt;
  const durationSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const accuracy =
    state.totalSwipes > 0
      ? Math.round(((state.totalSwipes - state.invalidSwipes) / state.totalSwipes) * 100)
      : 100;

  return (
    <View className="flex-1 justify-center px-6">
      <Text className="text-3xl font-bold text-foreground text-center mb-2">Game Over</Text>

      {state.mode === "timed" ? (
        <Text className="text-base text-muted-foreground text-center mb-6">Time's up!</Text>
      ) : (
        <Text className="text-base text-muted-foreground text-center mb-6">Out of lives</Text>
      )}

      {/* Final score */}
      <View className="items-center mb-6">
        <Text className="text-5xl font-bold text-primary">{state.score}</Text>
        <Text className="text-sm text-muted-foreground mt-1">points</Text>
      </View>

      {/* Stats grid */}
      <View className="gap-3 mb-8">
        <View className="flex-row justify-between">
          <Text className="text-base text-muted-foreground">Matches</Text>
          <Text className="text-base font-semibold text-foreground">{state.matchesMade}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-base text-muted-foreground">Pairs / Triples</Text>
          <Text className="text-base font-semibold text-foreground">
            {state.pairsMade} / {state.triplesMade}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-base text-muted-foreground">Best combo</Text>
          <Text className="text-base font-semibold text-yellow-400">x{state.maxCombo + 1}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-base text-muted-foreground">Accuracy</Text>
          <Text className="text-base font-semibold text-foreground">{accuracy}%</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-base text-muted-foreground">Duration</Text>
          <Text className="text-base font-semibold text-foreground">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </Text>
        </View>
      </View>

      <View className="gap-3">
        <Button label="Play Again" onPress={onPlayAgain} />
        <Button label="Return to List" variant="outline" onPress={onReturn} />
      </View>
    </View>
  );
}
