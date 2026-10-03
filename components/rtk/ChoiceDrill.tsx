import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { MnemonicText } from "@/components/MnemonicText";
import { PrimitiveChips } from "@/components/PrimitiveChips";
import { Text } from "@/components/ui/text";
import type { KanjiPrimitive } from "@/db/types";
import { buildChoices, type Choice } from "@/lib/rtk-distractors";
import type { CourseFrame } from "@/lib/rtk-course";

interface Props {
  /** `kanji` shows the glyph and asks for the keyword; `keyword` asks the reverse. */
  prompt: "kanji" | "keyword";
  frame: CourseFrame;
  /** Shown as the question's keyword when the learner has their own. */
  keyword: string | null;
  /** Path frames that look like this one, most alike first. */
  similar: readonly CourseFrame[];
  /** The frame's unit, to top up the options. */
  unit: readonly CourseFrame[];
  /** Revealed after a miss, if the learner has written one. */
  story: string | null;
  primitives: KanjiPrimitive[];
  onAnswer: (result: { correct: boolean; picked: CourseFrame; responseMs: number }) => void;
  /** Called when the learner has seen the result and the step is finished. */
  onDone: () => void;
  /** Too few options to ask with — the runner skips the step instead. */
  onUnaskable: () => void;
}

const OPTION_COUNT = 4;
/** A right answer is shown this long before moving on; a wrong one waits for a tap. */
const CORRECT_PAUSE_MS = 650;
/** Below this there is no question to ask. */
const MIN_OPTIONS = 2;

/**
 * One tap, four options, both directions. Visual confusion is the failure mode
 * RTK actually has, so the wrong answers are the frame's lookalikes — and a
 * miss shows the learner's own story rather than just the right answer.
 */
export function ChoiceDrill({
  prompt,
  frame,
  keyword,
  similar,
  unit,
  story,
  primitives,
  onAnswer,
  onDone,
  onUnaskable,
}: Props) {
  const [picked, setPicked] = useState<CourseFrame | null>(null);
  // A ref, not the state: two taps in the same frame would both read null.
  const answeredRef = useRef(false);
  const moveOn = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (moveOn.current) clearTimeout(moveOn.current);
    },
    [],
  );
  // In an effect, not in render: the clock is not a pure value.
  const askedAt = useRef(0);
  useEffect(() => {
    askedAt.current = Date.now();
  }, [frame.literal, prompt]);

  // Seeded by the frame and direction, so the answer's place is stable while the
  // question is on screen but not the same for every question.
  const choices: Choice[] = useMemo(
    () =>
      buildChoices(
        { answer: frame, similar, unit, count: OPTION_COUNT - 1 },
        frame.index * (prompt === "kanji" ? 1 : 2),
      ),
    [frame, similar, unit, prompt],
  );

  const answered = picked !== null;
  const shownKeyword = keyword ?? frame.keyword;

  // Below two options there is nothing to choose between.
  useEffect(() => {
    if (choices.length < MIN_OPTIONS) onUnaskable();
  }, [choices.length, onUnaskable]);

  const pick = useCallback(
    (choice: Choice) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      setPicked(choice.frame);
      onAnswer({
        correct: choice.correct,
        picked: choice.frame,
        responseMs: askedAt.current ? Date.now() - askedAt.current : 0,
      });
      // A right answer is worth a glance, not a tap; a wrong one is worth reading.
      // Cleared on unmount: leaving the node must not advance a queue behind it.
      if (choice.correct) moveOn.current = setTimeout(onDone, CORRECT_PAUSE_MS);
    },
    [onAnswer, onDone],
  );

  return (
    <View className="flex-1 p-4">
      <Text className="text-center text-xs text-muted-foreground">
        {prompt === "kanji" ? "What does this mean?" : "Which one is this?"}
      </Text>

      <View className="items-center py-6">
        {prompt === "kanji" ? (
          <Text className="text-7xl text-foreground">{frame.literal}</Text>
        ) : (
          <Text className="text-3xl font-semibold text-foreground">{shownKeyword}</Text>
        )}
      </View>

      <View className="gap-2">
        {choices.map((choice) => {
          const isPicked = picked?.literal === choice.frame.literal;
          const reveal = answered && (choice.correct || isPicked);
          const tone = !reveal
            ? "border-border bg-secondary"
            : choice.correct
              ? "border-green-500 bg-green-500/15"
              : "border-destructive bg-destructive/10";
          return (
            <Pressable
              key={choice.frame.literal}
              onPress={() => pick(choice)}
              disabled={answered}
              className={`items-center rounded-xl border px-4 py-3 active:opacity-80 ${tone}`}
            >
              <Text
                className={
                  prompt === "kanji"
                    ? "text-base text-foreground"
                    : "text-4xl leading-tight text-foreground"
                }
              >
                {prompt === "kanji"
                  ? // The answer wears the learner's own keyword, or the question
                    // and the answer would disagree about what this frame means.
                    choice.correct
                    ? shownKeyword
                    : choice.frame.keyword
                  : choice.frame.literal}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {answered && picked?.literal !== frame.literal ? (
        <View className="mt-5 rounded-xl border border-border p-3">
          <Text className="text-sm font-semibold text-foreground">
            {frame.literal} · {shownKeyword}
          </Text>
          {story ? (
            <MnemonicText
              mnemonic={story}
              selfKeyword={shownKeyword}
              primitives={primitives}
              className="mt-2 text-sm text-foreground"
            />
          ) : (
            <PrimitiveChips primitives={primitives} className="mt-2" />
          )}
          <Pressable
            onPress={onDone}
            className="mt-3 items-center rounded-xl bg-primary px-4 py-2 active:opacity-80"
          >
            <Text className="text-sm font-semibold text-primary-foreground">Got it</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
