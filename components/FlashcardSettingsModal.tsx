import React, { useEffect, useState } from "react";
import { Modal, Pressable, Platform, View, Switch, TextInput } from "react-native";
import { useAtom } from "jotai";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
import {
  flashcardFlipAnimationAtom,
  flashcardSwipeAnimationAtom,
  flashcardButtonAnimationAtom,
} from "@/stores/settings";
import { alert } from "@/lib/confirm";
import { requestVoicePermissions } from "@/lib/voice-recognition";
import { useSync } from "@/db/sync-provider";
import type { CardFace, FlashcardMode } from "@/db/types";

interface FlashcardSettingsModalProps {
  visible: boolean;
  onClose: (requiresReload?: boolean) => void;
  listId: string;
  onStartStudy?: () => void;
}

const FACE_OPTIONS: { key: CardFace; label: string }[] = [
  { key: "kanji", label: "Kanji" },
  { key: "kana", label: "Reading" },
  { key: "english", label: "Meaning" },
];

export function FlashcardSettingsModal({
  visible,
  onClose,
  listId,
  onStartStudy,
}: FlashcardSettingsModalProps) {
  const userDb = useUserDb();
  const { markDirty } = useSync();
  const list = useListsStore((s) => s.lists.find((l) => l.id === listId));
  const updateList = useListsStore((s) => s.updateList);

  const [mode, setMode] = useState<FlashcardMode>("add_order");
  const [frontFaces, setFrontFaces] = useState<CardFace[]>(["kanji"]);
  const [backFaces, setBackFaces] = useState<CardFace[]>(["english"]);
  const [autoPlayAudio, setAutoPlayAudio] = useState(false);
  const [confusionDetection, setConfusionDetection] = useState(true);
  const [voiceMode, setVoiceMode] = useState(false);
  const [typingMode, setTypingMode] = useState(false);
  const [flipAnimation, setFlipAnimation] = useAtom(flashcardFlipAnimationAtom);
  const [swipeAnimation, setSwipeAnimation] = useAtom(flashcardSwipeAnimationAtom);
  const [buttonAnimation, setButtonAnimation] = useAtom(flashcardButtonAnimationAtom);
  const [learningStepsText, setLearningStepsText] = useState("");
  const [relearningStepsText, setRelearningStepsText] = useState("");

  const inputMode = voiceMode ? "voice" : typingMode ? "typing" : "normal";

  function setInputMode(m: "normal" | "voice" | "typing") {
    if (m === "normal") {
      setVoiceMode(false);
      setTypingMode(false);
    } else if (m === "voice") {
      setTypingMode(false);
      // voice permission handled in the onPress
    } else {
      setVoiceMode(false);
      setTypingMode(true);
    }
  }

  useEffect(() => {
    if (visible && list) {
      setMode(list.flashcardMode);
      setFrontFaces([...list.frontFaces]);
      setBackFaces([...list.backFaces]);
      setAutoPlayAudio(list.autoPlayAudio);
      setConfusionDetection(list.confusionDetection !== false);
      setVoiceMode(list.voiceMode ?? false);
      setTypingMode(list.typingMode ?? false);
      setLearningStepsText(list.learningSteps ? list.learningSteps.join(", ") : "");
      setRelearningStepsText(list.relearningSteps ? list.relearningSteps.join(", ") : "");
    }
  }, [visible, list]);

  function toggleFace(current: CardFace[], setter: (v: CardFace[]) => void, face: CardFace) {
    if (current.includes(face)) {
      if (current.length > 1) {
        setter(current.filter((f) => f !== face));
      }
    } else {
      setter([...current, face]);
    }
  }

  function parseSteps(text: string): string[] | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const steps = trimmed.split(",").map((s) => s.trim());
    const valid = steps.every((s) => /^\d+[mhd]$/.test(s) && parseInt(s) > 0);
    if (!valid) return null;
    return steps;
  }

  async function handleSave() {
    if (!userDb) return;

    // Validate learning steps if provided
    let learningSteps: string[] | null = null;
    let relearningSteps: string[] | null = null;
    if (mode === "srs") {
      if (learningStepsText.trim()) {
        learningSteps = parseSteps(learningStepsText);
        if (!learningSteps) {
          alert(
            "Invalid Steps",
            "Learning steps must be comma-separated values like 1m, 10m, 1h, 1d",
          );
          return;
        }
      }
      if (relearningStepsText.trim()) {
        relearningSteps = parseSteps(relearningStepsText);
        if (!relearningSteps) {
          alert("Invalid Steps", "Relearning steps must be comma-separated values like 10m, 1h");
          return;
        }
      }
    }

    // Detect noop — skip save + reload if nothing changed
    if (list) {
      const arrEq = (a: unknown[] | null | undefined, b: unknown[] | null | undefined) =>
        JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
      const unchanged =
        mode === list.flashcardMode &&
        arrEq(frontFaces, list.frontFaces) &&
        arrEq(backFaces, list.backFaces) &&
        autoPlayAudio === list.autoPlayAudio &&
        confusionDetection === (list.confusionDetection !== false) &&
        voiceMode === (list.voiceMode ?? false) &&
        typingMode === (list.typingMode ?? false) &&
        arrEq(learningSteps, list.learningSteps) &&
        arrEq(relearningSteps, list.relearningSteps);
      if (unchanged) {
        onClose(false);
        return;
      }
    }

    const now = new Date().toISOString();
    await userDb.runAsync(
      "UPDATE lists SET flashcard_mode = ?, front_faces = ?, back_faces = ?, auto_play_audio = ?, confusion_detection = ?, voice_mode = ?, typing_mode = ?, learning_steps = ?, relearning_steps = ?, configured = 1, updated_at = ? WHERE id = ?",
      [
        mode,
        JSON.stringify(frontFaces),
        JSON.stringify(backFaces),
        autoPlayAudio ? 1 : 0,
        confusionDetection ? 1 : 0,
        voiceMode ? 1 : 0,
        typingMode ? 1 : 0,
        learningSteps ? JSON.stringify(learningSteps) : null,
        relearningSteps ? JSON.stringify(relearningSteps) : null,
        now,
        listId,
      ],
    );
    updateList(listId, {
      configured: true,
      flashcardMode: mode,
      frontFaces,
      backFaces,
      autoPlayAudio,
      confusionDetection,
      voiceMode,
      typingMode,
      learningSteps,
      relearningSteps,
      updatedAt: now,
    });
    markDirty();
    if (onStartStudy) {
      onStartStudy();
    } else {
      onClose(mode !== list?.flashcardMode);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose(false)}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={() => onClose(false)}>
        <Pressable onPress={() => {}}>
          <View
            className="rounded-2xl border border-border bg-background p-5"
            style={
              Platform.OS === "web"
                ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Text className="text-lg font-semibold text-foreground mb-4">Flashcard Settings</Text>

            {/* Mode toggle */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Mode</Text>
            <View className="flex-row gap-2 mb-4">
              <Pressable
                onPress={() => setMode("add_order")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  mode === "add_order" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    mode === "add_order" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Sequential
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("simple_srs")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  mode === "simple_srs" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    mode === "simple_srs" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Simple SRS
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("srs")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  mode === "srs" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    mode === "srs" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  FSRS
                </Text>
              </Pressable>
            </View>

            {/* Learning steps (FSRS only) */}
            {mode === "srs" && (
              <View className="mb-4">
                <Text className="text-sm font-medium text-muted-foreground mb-2">
                  Learning steps
                </Text>
                <TextInput
                  value={learningStepsText}
                  onChangeText={setLearningStepsText}
                  placeholder="1m, 10m"
                  placeholderTextColor="#999"
                  className="border border-border rounded-lg px-3 py-2 text-sm text-foreground mb-3"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text className="text-sm font-medium text-muted-foreground mb-2">
                  Relearning steps
                </Text>
                <TextInput
                  value={relearningStepsText}
                  onChangeText={setRelearningStepsText}
                  placeholder="10m"
                  placeholderTextColor="#999"
                  className="border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            {/* Front faces */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Front</Text>
            <View className="flex-row gap-2 mb-4">
              {FACE_OPTIONS.map((opt) => {
                const active = frontFaces.includes(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => toggleFace(frontFaces, setFrontFaces, opt.key)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      active ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        active ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Back faces */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Back</Text>
            <View className="flex-row gap-2 mb-4">
              {FACE_OPTIONS.map((opt) => {
                const active = backFaces.includes(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => toggleFace(backFaces, setBackFaces, opt.key)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      active ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        active ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Toggle switches */}
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm text-foreground">Play audio on reveal</Text>
              <Switch value={autoPlayAudio} onValueChange={setAutoPlayAudio} />
            </View>

            {mode !== "add_order" && (
              <View className="flex-row items-center justify-between py-2">
                <Text className="text-sm text-foreground">Similar word detection</Text>
                <Switch value={confusionDetection} onValueChange={setConfusionDetection} />
              </View>
            )}

            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm text-foreground">Flip animation</Text>
              <Switch value={flipAnimation} onValueChange={setFlipAnimation} />
            </View>

            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm text-foreground">Swipe animation</Text>
              <Switch value={swipeAnimation} onValueChange={setSwipeAnimation} />
            </View>

            <View className="flex-row items-center justify-between py-2 mb-3">
              <Text className="text-sm text-foreground">Button animation</Text>
              <Switch value={buttonAnimation} onValueChange={setButtonAnimation} />
            </View>

            {/* Input mode */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Input mode</Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setInputMode("normal")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  inputMode === "normal" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    inputMode === "normal" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Normal
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const granted = await requestVoicePermissions();
                  if (granted) {
                    setVoiceMode(true);
                    setTypingMode(false);
                  } else {
                    alert(
                      "Permission Required",
                      "Microphone and speech recognition permissions are needed for voice mode.",
                    );
                  }
                }}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  inputMode === "voice" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    inputMode === "voice" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Voice
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setInputMode("typing")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  inputMode === "typing" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    inputMode === "typing" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Typing
                </Text>
              </Pressable>
            </View>

            {/* Actions */}
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                variant="outline"
                label="Cancel"
                onPress={() => onClose(false)}
              />
              <Button
                className="flex-1"
                label={onStartStudy ? "Start Study" : "Save"}
                onPress={handleSave}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
