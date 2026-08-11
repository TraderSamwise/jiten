import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import type { ContextSentence } from "@/lib/context-sentences";
import { getKanjiColor, type CharStatus } from "@/lib/typing-utils";

function statusColor(status: CharStatus | undefined): string {
  return status === "correct"
    ? "text-green-500"
    : status === "wrong"
      ? "text-red-500"
      : status === "pending"
        ? "text-green-300"
        : "text-muted-foreground";
}

/**
 * The sentence with its target word picked out in red. Splitting on indexOf is
 * safe because the surface is validated to occur exactly once.
 */
export function SentenceView({
  sentence,
  statuses,
  revealed,
  completed,
  correct,
  showEnglish,
  onPressTarget,
}: {
  sentence: ContextSentence;
  statuses: CharStatus[];
  /** Assist: show the answer reading above the target. */
  revealed: boolean;
  completed: boolean;
  correct: boolean;
  showEnglish: boolean;
  /** Opens the word's dictionary entry. Omitted, the target isn't tappable. */
  onPressTarget?: () => void;
}) {
  const { targetSurface, targetReading } = sentence;
  const at = sentence.sentence.indexOf(targetSurface);
  const prefix = at >= 0 ? sentence.sentence.slice(0, at) : sentence.sentence;
  const suffix = at >= 0 ? sentence.sentence.slice(at + targetSurface.length) : "";

  const surfaceChars = [...targetSurface];
  const readingChars = [...targetReading];
  const showReading = revealed || completed;

  const targetColor = completed
    ? correct
      ? "text-green-500"
      : "text-red-400"
    : "text-red-500 dark:text-red-400";

  return (
    <View className="items-center gap-4">
      <View className="flex-row flex-wrap items-end justify-center">
        <Text className="text-2xl text-muted-foreground">{prefix}</Text>

        <Pressable className="items-center" onPress={onPressTarget} disabled={!onPressTarget}>
          {/* Reading sits above the target, matching the furigana slot in the typing game */}
          {showReading ? (
            <View className="flex-row">
              {readingChars.map((char, i) => (
                <Text key={i} className={`text-base ${statusColor(statuses[i])}`}>
                  {char}
                </Text>
              ))}
            </View>
          ) : (
            <Text className="text-base text-transparent">{targetReading}</Text>
          )}

          <View className="flex-row">
            {surfaceChars.map((char, i) => {
              const color = completed
                ? null
                : getKanjiColor(surfaceChars, statuses, readingChars.length, i);
              const colorClass =
                color === "green"
                  ? "text-green-500"
                  : color === "red"
                    ? "text-red-500"
                    : color === "pending"
                      ? "text-green-300"
                      : targetColor;
              return (
                <Text key={i} className={`text-2xl font-bold ${colorClass}`}>
                  {char}
                </Text>
              );
            })}
          </View>
        </Pressable>

        <Text className="text-2xl text-muted-foreground">{suffix}</Text>
      </View>

      {(showEnglish || completed) && (
        <Text className="text-sm text-muted-foreground text-center px-4">{sentence.english}</Text>
      )}
    </View>
  );
}
