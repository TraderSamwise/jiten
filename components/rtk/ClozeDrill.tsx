import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { MnemonicText } from "@/components/MnemonicText";
import { Text } from "@/components/ui/text";
import type { KanjiPrimitive } from "@/db/types";
import { accepts, canCloze, clozed } from "@/lib/rtk-cloze";
import type { CourseFrame } from "@/lib/rtk-course";

interface Props {
  frame: CourseFrame;
  keyword: string | null;
  /** The learner's own story; without one there is nothing to cloze. */
  story: string | null;
  primitives: KanjiPrimitive[];
  /** Accepted alternatives for the keyword, from `keyword_synonyms`. */
  synonyms: readonly string[];
  onAnswer: (result: { correct: boolean; typed: string; responseMs: number }) => void;
  onDone: () => void;
  /** No story, or one that never names the keyword. */
  onUnaskable: () => void;
}

const CORRECT_PAUSE_MS = 650;

/**
 * The learner's own story with its keyword taken out. This is the only drill
 * that tests the hook itself rather than the frame — if the story does not
 * bring the keyword back, the story is the thing that needs rewriting.
 */
export function ClozeDrill({
  frame,
  keyword,
  story,
  primitives,
  synonyms,
  onAnswer,
  onDone,
  onUnaskable,
}: Props) {
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<"waiting" | "right" | "wrong">("waiting");
  const answeredRef = useRef(false);
  const askedAt = useRef(0);
  const moveOn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = keyword ?? frame.keyword;
  const askable = canCloze(story, shown);

  useEffect(() => {
    askedAt.current = Date.now();
  }, [frame.literal]);

  useEffect(
    () => () => {
      if (moveOn.current) clearTimeout(moveOn.current);
    },
    [],
  );

  useEffect(() => {
    if (!askable) onUnaskable();
  }, [askable, onUnaskable]);

  const blanked = useMemo(
    () => (story && askable ? clozed(story, shown) : ""),
    [story, shown, askable],
  );

  const check = useCallback(() => {
    if (answeredRef.current || !typed.trim()) return;
    answeredRef.current = true;
    const correct = accepts(typed, shown, synonyms);
    setVerdict(correct ? "right" : "wrong");
    onAnswer({
      correct,
      typed: typed.trim(),
      responseMs: askedAt.current ? Date.now() - askedAt.current : 0,
    });
    if (correct) moveOn.current = setTimeout(onDone, CORRECT_PAUSE_MS);
  }, [typed, shown, synonyms, onAnswer, onDone]);

  if (!askable) return <View className="flex-1" />;

  return (
    <View className="flex-1 p-4">
      <Text className="text-center text-xs text-muted-foreground">
        Your story, with the keyword missing
      </Text>

      <View className="mt-5 rounded-xl border border-border p-3">
        <MnemonicText
          mnemonic={blanked}
          selfKeyword={shown}
          primitives={primitives}
          className="text-base text-foreground"
        />
      </View>

      <View className="mt-4 flex-row items-center gap-2">
        <TextInput
          className="flex-1 rounded-lg bg-secondary/50 px-3 py-2 text-base text-foreground"
          value={typed}
          onChangeText={setTyped}
          placeholder="the missing keyword"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          editable={verdict === "waiting"}
          returnKeyType="done"
          onSubmitEditing={check}
        />
        <Pressable
          onPress={check}
          disabled={verdict !== "waiting"}
          className={`rounded-lg px-4 py-2 active:opacity-80 ${
            verdict === "waiting" ? "bg-primary" : "bg-secondary"
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              verdict === "waiting" ? "text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            Check
          </Text>
        </Pressable>
      </View>

      {verdict === "right" ? (
        <Text className="mt-3 text-center text-sm text-green-600">{shown}</Text>
      ) : null}

      {verdict === "wrong" ? (
        <View className="mt-4 rounded-xl border border-border p-3">
          <Text className="text-sm font-semibold text-foreground">
            {frame.literal} · {shown}
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            If the story did not bring it back, the story is the thing to rewrite.
          </Text>
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
