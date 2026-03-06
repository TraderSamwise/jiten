import React, { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
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
import type { CardFace, FlashcardMode } from "@/db/types";

interface FlashcardSettingsModalProps {
  visible: boolean;
  onClose: () => void;
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

  async function handleSave() {
    if (!userDb) return;
    const now = new Date().toISOString();
    await userDb.runAsync(
      "UPDATE lists SET flashcard_mode = ?, front_faces = ?, back_faces = ?, auto_play_audio = ?, confusion_detection = ?, voice_mode = ?, typing_mode = ?, configured = 1, updated_at = ? WHERE id = ?",
      [
        mode,
        JSON.stringify(frontFaces),
        JSON.stringify(backFaces),
        autoPlayAudio ? 1 : 0,
        confusionDetection ? 1 : 0,
        voiceMode ? 1 : 0,
        typingMode ? 1 : 0,
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
      updatedAt: now,
    });
    if (onStartStudy) {
      onStartStudy();
    } else {
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View className="rounded-2xl border border-border bg-background p-5">
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

            {/* Auto-play audio */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">
              Play audio on reveal
            </Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setAutoPlayAudio(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  !autoPlayAudio ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    !autoPlayAudio ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Off
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAutoPlayAudio(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  autoPlayAudio ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    autoPlayAudio ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  On
                </Text>
              </Pressable>
            </View>

            {/* Confusion detection (only for SRS modes) */}
            {mode !== "add_order" && (
              <>
                <Text className="text-sm font-medium text-muted-foreground mb-2">
                  Similar word detection
                </Text>
                <View className="flex-row gap-2 mb-5">
                  <Pressable
                    onPress={() => setConfusionDetection(false)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      !confusionDetection ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        !confusionDetection ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      Off
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setConfusionDetection(true)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      confusionDetection ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        confusionDetection ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      On
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

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

            {/* Flip animation */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Flip animation</Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setFlipAnimation(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  !flipAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    !flipAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Off
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFlipAnimation(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  flipAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    flipAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  On
                </Text>
              </Pressable>
            </View>

            {/* Swipe animation */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Swipe animation</Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setSwipeAnimation(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  !swipeAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    !swipeAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Off
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSwipeAnimation(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  swipeAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    swipeAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  On
                </Text>
              </Pressable>
            </View>

            {/* Button animation */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">Button animation</Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setButtonAnimation(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  !buttonAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    !buttonAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Off
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setButtonAnimation(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  buttonAnimation ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    buttonAnimation ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  On
                </Text>
              </Pressable>
            </View>

            {/* Actions */}
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="outline" label="Cancel" onPress={onClose} />
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
