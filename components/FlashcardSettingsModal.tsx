import React, { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
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

  useEffect(() => {
    if (visible && list) {
      setMode(list.flashcardMode);
      setFrontFaces([...list.frontFaces]);
      setBackFaces([...list.backFaces]);
    }
  }, [visible, list]);

  function toggleFace(
    current: CardFace[],
    setter: (v: CardFace[]) => void,
    face: CardFace
  ) {
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
      "UPDATE lists SET flashcard_mode = ?, front_faces = ?, back_faces = ?, configured = 1, updated_at = ? WHERE id = ?",
      [mode, JSON.stringify(frontFaces), JSON.stringify(backFaces), now, listId]
    );
    updateList(listId, {
      configured: true,
      flashcardMode: mode,
      frontFaces,
      backFaces,
      updatedAt: now,
    });
    if (onStartStudy) {
      onStartStudy();
    } else {
      onClose();
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1">
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          className="bg-black/50"
          onPress={onClose}
        />

        <View className="flex-1 justify-center px-6">
          <View className="rounded-2xl border border-border bg-background p-5">
            <Text className="text-lg font-semibold text-foreground mb-4">
              Flashcard Settings
            </Text>

            {/* Mode toggle */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">
              Mode
            </Text>
            <View className="flex-row gap-2 mb-4">
              <Pressable
                onPress={() => setMode("add_order")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  mode === "add_order"
                    ? "border-primary bg-primary/10"
                    : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    mode === "add_order"
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  Sequential
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("srs")}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  mode === "srs"
                    ? "border-primary bg-primary/10"
                    : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    mode === "srs" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Spaced Rep
                </Text>
              </Pressable>
            </View>

            {/* Front faces */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">
              Front
            </Text>
            <View className="flex-row gap-2 mb-4">
              {FACE_OPTIONS.map((opt) => {
                const active = frontFaces.includes(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => toggleFace(frontFaces, setFrontFaces, opt.key)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border"
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
            <Text className="text-sm font-medium text-muted-foreground mb-2">
              Back
            </Text>
            <View className="flex-row gap-2 mb-5">
              {FACE_OPTIONS.map((opt) => {
                const active = backFaces.includes(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => toggleFace(backFaces, setBackFaces, opt.key)}
                    className={`flex-1 items-center rounded-lg border py-2 ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border"
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

            {/* Actions */}
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                variant="outline"
                label="Cancel"
                onPress={onClose}
              />
              <Button className="flex-1" label={onStartStudy ? "Start Study" : "Save"} onPress={handleSave} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
