import React, { useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { MnemonicEditor } from "@/components/MnemonicEditor";
import { MnemonicText } from "@/components/MnemonicText";
import { PrimitiveChips } from "@/components/PrimitiveChips";
import { firstSentences } from "@/lib/wikitext";
import { Text } from "@/components/ui/text";
import type { KanjiPrimitive } from "@/db/types";
import type { GenerationState } from "@/hooks/useMnemonicGeneration";
import type { CourseFrame } from "@/lib/rtk-course";

interface Props {
  frame: CourseFrame;
  primitives: KanjiPrimitive[];
  /** The learner's own keyword, when they have set one. */
  keyword: string | null;
  /** What the glyph actually depicts, when the dictionary knows. */
  glyphOrigin?: string | null;
  /** The story already saved for this frame, if any. */
  story: string | null;
  generation: GenerationState;
  /** True once the strokes tier is present; without it there are no primitives. */
  canGenerate: boolean;
  onGenerate: (fresh: boolean) => void;
  onSave: (story: string) => void;
  /** Saves the learner's own keyword for this frame, replacing Heisig's. */
  onKeyword: (keyword: string) => void;
  /** Moves on from a frame that already has a story: met, not skipped. */
  onKeep: () => void;
  /** Shown when a save failed, so the learner knows their text is still here. */
  saveError?: string | null;
  onSkip: () => void;
}

function Action({
  label,
  hint,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 items-center rounded-xl px-4 py-3 active:opacity-80 ${
        primary ? "bg-primary" : "border border-border bg-secondary"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <Text
        className={`text-base font-semibold ${
          primary ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {label}
      </Text>
      {hint ? (
        <Text
          className={`text-xs ${primary ? "text-primary-foreground/80" : "text-muted-foreground"}`}
        >
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Meeting one frame: the kanji, its primitives, and the choice of writing a
 * story or having one written. A generated story lands in the same editor the
 * writing path uses, so there is one surface to learn and tweaking is editing.
 */
export function MeetFrame({
  frame,
  primitives,
  keyword,
  glyphOrigin,
  story,
  generation,
  canGenerate,
  onGenerate,
  onSave,
  onKeyword,
  onKeep,
  onSkip,
  saveError,
}: Props) {
  // Only the learner's intent is state. The draft is derived, so no render ever
  // sets state and a regenerate cannot race the editor.
  const [opened, setOpened] = useState(0);
  // The editor instance the learner dismissed; a new one reopens on its own.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState<string | null>(null);
  // Set by Regenerate: an ask from inside the editor, which may replace the text.
  const [asked, setAsked] = useState(false);

  const shown = keyword ?? frame.keyword;
  const mine = generation.literal === frame.literal;
  const generated = mine && generation.story !== null;
  const loading = mine && generation.loading;
  const failed = mine && generation.message !== null;

  // A story that lands while the learner is writing their OWN must not replace
  // it: they opened the editor themselves and nothing warned them. Regenerate,
  // from inside the editor, is an explicit ask — that one does replace.
  const theirs = opened > 0 && !asked;
  const takeGenerated = generated && !theirs;

  const draft = takeGenerated ? generation.story! : (story ?? "");
  // Remounting on a new attempt is what lets a regenerate replace the text:
  // MnemonicEditor reads initialValue once. A regenerate therefore discards
  // tweaks when the new story lands — but not while it is still on its way.
  const editorKey = `${frame.literal}:${generated ? generation.attempt : 0}:${opened}`;
  // Not `|| loading`: on the FIRST generate there is no story yet, and an empty
  // editor while waiting is worse than the spinner. A regenerate keeps the
  // editor because the hook keeps the story it already has.
  const editing = (opened > 0 || generated) && dismissed !== editorKey;

  // Commits on blur as well as submit, like the kanji page: tapping away must
  // not discard what was typed.
  const commitKeyword = () => {
    if (keywordDraft !== null) onKeyword(keywordDraft);
    setKeywordDraft(null);
  };
  return (
    <View className="flex-1 p-4">
      <View className="items-center">
        <Text className="text-xs text-muted-foreground">Frame {frame.index}</Text>
        <Text className="text-7xl text-foreground">{frame.literal}</Text>
        {keywordDraft === null ? (
          <Pressable onPress={() => setKeywordDraft(shown)} className="active:opacity-70">
            <Text className="mt-1 text-xl font-semibold text-foreground">{shown}</Text>
          </Pressable>
        ) : (
          <TextInput
            className="mt-1 rounded-lg bg-secondary/50 px-3 py-1 text-xl font-semibold text-foreground"
            value={keywordDraft}
            onChangeText={setKeywordDraft}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={commitKeyword}
            onBlur={commitKeyword}
          />
        )}
      </View>

      <PrimitiveChips primitives={primitives} className="mt-4" />

      {/* The real history, offered beside the parts: often the better hook, and
          the one a learner cannot invent. Wiktionary, CC BY-SA 4.0. */}
      {glyphOrigin ? (
        <View className="mt-3 rounded-xl border border-border p-3">
          <Text className="text-xs text-muted-foreground">Where it comes from</Text>
          <Text className="mt-1 text-sm text-foreground">{firstSentences(glyphOrigin, 260)}</Text>
        </View>
      ) : null}

      {editing ? (
        <View className="mt-5">
          {failed ? (
            <Text className="mb-2 text-sm text-destructive">{generation.message}</Text>
          ) : null}
          {saveError ? <Text className="mb-2 text-sm text-destructive">{saveError}</Text> : null}
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm text-muted-foreground">Your story</Text>
            <Pressable
              onPress={() => {
                setDismissed(null);
                setAsked(true);
                onGenerate(true);
              }}
              disabled={!canGenerate || loading}
              className="rounded-lg border border-border px-3 py-1.5 active:opacity-70"
            >
              <Text className="text-xs font-medium text-foreground">
                {loading ? "Writing…" : "Regenerate"}
              </Text>
            </Pressable>
          </View>
          <MnemonicEditor
            key={editorKey}
            literal={frame.literal}
            initialValue={draft}
            primitives={primitives}
            onSave={onSave}
            onCancel={() => setDismissed(editorKey)}
          />
        </View>
      ) : (
        <View className="mt-6 gap-3">
          {story ? (
            <View className="rounded-xl border border-border p-3">
              <MnemonicText
                mnemonic={story}
                selfKeyword={shown}
                primitives={primitives}
                className="text-base text-foreground"
              />
            </View>
          ) : null}

          {failed ? <Text className="text-sm text-destructive">{generation.message}</Text> : null}

          {loading ? (
            <View className="items-center py-2">
              <ActivityIndicator />
              <Text className="mt-1 text-xs text-muted-foreground">Writing a story…</Text>
            </View>
          ) : null}

          <View className="flex-row gap-3">
            <Action
              label={story ? "Edit it" : "Write it"}
              onPress={() => setOpened((n) => n + 1)}
            />
            <Action
              label="Generate"
              hint={canGenerate ? undefined : "needs stroke data"}
              primary
              disabled={!canGenerate || loading}
              onPress={() => {
                setDismissed(null);
                onGenerate(false);
              }}
            />
          </View>

          <Pressable
            onPress={story ? onKeep : onSkip}
            className="items-center py-2 active:opacity-70"
          >
            <Text className="text-sm text-muted-foreground">
              {story ? "Next frame" : "Skip for now"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
