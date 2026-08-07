import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Platform, View } from "react-native";
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
  const [loading, setLoading] = useState<
    "typing" | "context" | "fillBlank" | "connect" | "arena" | null
  >(null);

  function handleTypingGame() {
    setLoading("typing");
    setTimeout(() => {
      onClose();
      router.push(`/lists/typing-game?listId=${listId}`);
    }, 100);
  }

  function handleContextGame() {
    setLoading("context");
    setTimeout(() => {
      onClose();
      router.push(`/lists/context-game?listId=${listId}`);
    }, 100);
  }

  function handleFillBlankGame() {
    setLoading("fillBlank");
    setTimeout(() => {
      onClose();
      router.push(`/lists/fill-blank?listId=${listId}`);
    }, 100);
  }

  function handleConnectGame() {
    setLoading("connect");
    setTimeout(() => {
      onClose();
      router.push(`/lists/connect-game?listId=${listId}`);
    }, 100);
  }

  function handleArenaGame() {
    setLoading("arena");
    setTimeout(() => {
      onClose();
      router.push(`/lists/kanji-arena?listId=${listId}`);
    }, 100);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => setLoading(null)}
    >
      <Pressable
        className="flex-1 justify-center px-6 bg-black/50"
        onPress={loading ? undefined : onClose}
      >
        <Pressable onPress={() => {}}>
          <View
            className="rounded-2xl border border-border bg-background p-5"
            style={
              Platform.OS === "web"
                ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Text className="text-lg font-semibold text-foreground mb-4">Games</Text>

            <View className="gap-3">
              <Pressable
                onPress={handleTypingGame}
                disabled={loading !== null}
                className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
                style={loading !== null ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text className="text-base font-medium text-foreground">Typing Game</Text>
                  <Text className="text-sm text-muted-foreground">
                    Type readings as words flow by
                  </Text>
                </View>
                {loading === "typing" ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <ChevronRight size={20} className="text-muted-foreground" />
                )}
              </Pressable>

              <Pressable
                onPress={handleContextGame}
                disabled={loading !== null}
                className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
                style={loading !== null ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text className="text-base font-medium text-foreground">Read in Context</Text>
                  <Text className="text-sm text-muted-foreground">
                    Type the reading of the highlighted word
                  </Text>
                </View>
                {loading === "context" ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <ChevronRight size={20} className="text-muted-foreground" />
                )}
              </Pressable>

              <Pressable
                onPress={handleFillBlankGame}
                disabled={loading !== null}
                className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
                style={loading !== null ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text className="text-base font-medium text-foreground">Fill in the Blank</Text>
                  <Text className="text-sm text-muted-foreground">
                    Choose the word that completes the sentence
                  </Text>
                </View>
                {loading === "fillBlank" ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <ChevronRight size={20} className="text-muted-foreground" />
                )}
              </Pressable>

              <Pressable
                onPress={handleConnectGame}
                disabled={loading !== null}
                className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
                style={loading !== null ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text className="text-base font-medium text-foreground">Connect Game</Text>
                  <Text className="text-sm text-muted-foreground">
                    Swipe to match kanji, readings, and meanings
                  </Text>
                </View>
                {loading === "connect" ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <ChevronRight size={20} className="text-muted-foreground" />
                )}
              </Pressable>

              <Pressable
                onPress={handleArenaGame}
                disabled={loading !== null}
                className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
                style={loading !== null ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text className="text-base font-medium text-foreground">Kanji Arena</Text>
                  <Text className="text-sm text-muted-foreground">
                    Learn and review your kanji as a roguelite
                  </Text>
                </View>
                {loading === "arena" ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <ChevronRight size={20} className="text-muted-foreground" />
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
