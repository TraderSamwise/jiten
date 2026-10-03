import React, { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { MnemonicText } from "@/components/MnemonicText";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { getSynonymsForKeywordAsync } from "@/db/kanji-search";
import type { KanjiPrimitive } from "@/db/types";
import { accepts, clozed } from "@/lib/rtk-cloze";

interface Props {
  keyword: string;
  /** The learner's own story. The caller has already checked it can be clozed. */
  story: string;
  primitives: KanjiPrimitive[];
  /** Fires once, with whether they recalled the keyword. */
  onComplete: (wasCorrect: boolean) => void;
}

/**
 * The front of a kanji card, asked as the learner's own story with the keyword
 * blanked. Reading a mnemonic is recognition; producing the word it was built
 * to retrieve is recall, and that is the half that strengthens the hook.
 */
export function MnemonicClozeInput({ keyword, story, primitives, onComplete }: Props) {
  const { strokesDb } = useDatabase();
  const [typed, setTyped] = useState("");
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const inputRef = useRef<TextInput>(null);
  const answered = useRef(false);

  useEffect(() => {
    const focus = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(focus);
  }, []);

  useEffect(() => {
    if (!strokesDb || !keyword) return;
    let current = true;
    getSynonymsForKeywordAsync(strokesDb, keyword)
      // Without them the stem match still forgives a plural or a tense, so a
      // failure here costs leniency, not the exercise.
      .then((words) => {
        if (current) setSynonyms(words);
      })
      .catch((err) => console.warn("[cloze] could not load synonyms", err));
    return () => {
      current = false;
    };
  }, [strokesDb, keyword]);

  function answer(wasCorrect: boolean) {
    if (answered.current) return;
    answered.current = true;
    inputRef.current?.blur();
    onComplete(wasCorrect);
  }

  function check() {
    if (!typed.trim()) return;
    answer(accepts(typed, keyword, synonyms));
  }

  return (
    <View className="w-full px-4">
      <Text className="text-center text-xs text-muted-foreground">
        Your story, with the keyword missing
      </Text>

      <View className="mt-3 rounded-xl border border-border p-3">
        <MnemonicText
          mnemonic={clozed(story, keyword)}
          selfKeyword={keyword}
          primitives={primitives}
          className="text-base text-foreground"
        />
      </View>

      <View className="mt-4 flex-row items-center gap-2">
        <TextInput
          ref={inputRef}
          className="flex-1 rounded-lg bg-secondary/50 px-3 py-2 text-base text-foreground"
          value={typed}
          onChangeText={setTyped}
          placeholder="the missing keyword"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={check}
        />
        <Pressable onPress={check} className="rounded-lg bg-primary px-4 py-2 active:opacity-80">
          <Text className="text-sm font-semibold text-primary-foreground">Check</Text>
        </Pressable>
      </View>

      {/* The card's own back is the answer, so giving up just turns it over. */}
      <Pressable onPress={() => answer(false)} className="mt-2 items-center py-1 active:opacity-70">
        <Text className="text-xs text-muted-foreground">Give up</Text>
      </Pressable>
    </View>
  );
}
