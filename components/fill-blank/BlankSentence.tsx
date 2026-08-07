import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import type { FillBlankQuestion } from "@/lib/fill-blank";

const BLANK = "＿＿＿";

/**
 * The sentence with its answer cut out. Splitting on indexOf is safe because the
 * answer surface is validated to occur exactly once.
 */
export function BlankSentence({
  question,
  answered,
  showEnglish,
}: {
  question: FillBlankQuestion;
  /** Once answered the blank is filled in, so the sentence can be read whole. */
  answered: boolean;
  showEnglish: boolean;
}) {
  const { sentence, answerSurface, answerReading, english, hint } = question;
  const at = sentence.indexOf(answerSurface);
  const prefix = at >= 0 ? sentence.slice(0, at) : sentence;
  const suffix = at >= 0 ? sentence.slice(at + answerSurface.length) : "";

  return (
    <View className="items-center gap-4">
      <View className="flex-row flex-wrap items-end justify-center">
        <Text className="text-2xl text-foreground">{prefix}</Text>

        <View className="items-center">
          {/* A space holds the line height open. Rendering the real reading in
              transparent text would leave it selectable on web. */}
          <Text className="text-base text-green-500">{answered ? answerReading : " "}</Text>
          <Text
            className={`text-2xl font-bold ${answered ? "text-green-500" : "text-muted-foreground"}`}
          >
            {answered ? answerSurface : BLANK}
          </Text>
        </View>

        <Text className="text-2xl text-foreground">{suffix}</Text>
      </View>

      {/* Only after answering: the translation contains the answer */}
      {answered && showEnglish && (
        <Text className="text-sm text-muted-foreground text-center px-4">{english}</Text>
      )}
      {answered && hint.length > 0 && (
        <Text className="text-sm text-yellow-600 dark:text-yellow-500 text-center px-4">
          {hint}
        </Text>
      )}
    </View>
  );
}
