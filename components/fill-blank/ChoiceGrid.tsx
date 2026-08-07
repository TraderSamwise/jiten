import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import type { FillBlankOption } from "@/lib/fill-blank";

function choiceClass(state: "idle" | "correct" | "wrong" | "missed"): string {
  switch (state) {
    case "correct":
      return "border-green-500 bg-green-500/10";
    case "wrong":
      return "border-red-500 bg-red-500/10";
    // The right answer, revealed after a wrong pick
    case "missed":
      return "border-green-500";
    case "idle":
      return "border-border";
  }
}

function textClass(state: "idle" | "correct" | "wrong" | "missed"): string {
  if (state === "correct" || state === "missed") return "text-green-500";
  if (state === "wrong") return "text-red-500";
  return "text-foreground";
}

export function ChoiceGrid({
  options,
  answerIndex,
  chosenIndex,
  showFurigana,
  onChoose,
}: {
  options: FillBlankOption[];
  answerIndex: number;
  /** Null until the player picks; locks the grid once set. */
  chosenIndex: number | null;
  showFurigana: boolean;
  onChoose: (index: number) => void;
}) {
  const answered = chosenIndex !== null;

  return (
    <View className="gap-3">
      {options.map((option, index) => {
        const state = !answered
          ? "idle"
          : index === answerIndex
            ? index === chosenIndex
              ? "correct"
              : "missed"
            : index === chosenIndex
              ? "wrong"
              : "idle";

        return (
          <Pressable
            key={`${option.word}-${index}`}
            onPress={() => onChoose(index)}
            disabled={answered}
            className={`min-h-14 items-center justify-center rounded-lg border px-4 py-2 active:opacity-70 ${choiceClass(state)}`}
          >
            {/* Reserved even when hidden, so revealing readings doesn't resize the row */}
            <Text
              className={`text-xs ${showFurigana || answered ? "text-muted-foreground" : "text-transparent"}`}
            >
              {option.reading}
            </Text>
            <Text className={`text-xl font-medium ${textClass(state)}`}>{option.surface}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
