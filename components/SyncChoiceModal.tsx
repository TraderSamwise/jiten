import React from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

interface SyncChoiceModalProps {
  visible: boolean;
  onChoice: (choice: "merge" | "use-cloud" | "use-local") => void;
  title?: string;
  description?: string;
}

export function SyncChoiceModal({
  visible,
  onChoice,
  title = "Existing Local Data",
  description = "You have data on this device. How should we handle it with your cloud account?",
}: SyncChoiceModalProps) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade">
      <Pressable className="flex-1 justify-center px-6 bg-black/50">
        <View
          className="rounded-2xl border border-border bg-background p-5"
          style={
            Platform.OS === "web"
              ? { maxWidth: 500, width: "100%", alignSelf: "center" }
              : undefined
          }
        >
          <Text className="text-lg font-semibold text-foreground mb-2">{title}</Text>
          <Text className="text-sm text-muted-foreground mb-4">{description}</Text>
          <View className="gap-2">
            <Button label="Merge" variant="default" onPress={() => onChoice("merge")} />
            <Button
              label="Use Cloud Data"
              variant="outline"
              onPress={() => onChoice("use-cloud")}
            />
            <Button
              label="Use Local Data"
              variant="outline"
              onPress={() => onChoice("use-local")}
            />
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
