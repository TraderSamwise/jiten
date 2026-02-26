import React from "react";
import { Modal, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { ChevronRight } from "@/lib/icons";

interface GamesModalProps {
  visible: boolean;
  onClose: () => void;
  listId: string;
}

export function GamesModal({ visible, onClose, listId }: GamesModalProps) {
  const router = useRouter();

  function handleTypingGame() {
    onClose();
    router.push(`/lists/typing-game?listId=${listId}`);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View className="rounded-2xl border border-border bg-background p-5">
            <Text className="text-lg font-semibold text-foreground mb-4">Games</Text>

            <Pressable
              onPress={handleTypingGame}
              className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <View>
                <Text className="text-base font-medium text-foreground">Typing Game</Text>
                <Text className="text-sm text-muted-foreground">
                  Type readings as words flow by
                </Text>
              </View>
              <ChevronRight size={20} className="text-muted-foreground" />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
