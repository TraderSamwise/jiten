import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";

const STATE_LABELS: Record<string, string> = {
  downloading: "Downloading",
  importing: "Importing",
  pending: "Preparing",
};

export function BackgroundDownloadBanner() {
  const { backgroundStatus } = useDatabase();

  // Find the active item (first non-ready, non-error, non-pending)
  const activeItem = backgroundStatus.find(
    (item) => item.state === "downloading" || item.state === "importing",
  );

  if (!activeItem) return null;

  const percent = Math.round((activeItem.progress ?? 0) * 100);
  const stateLabel = STATE_LABELS[activeItem.state] ?? "Preparing";

  return (
    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} pointerEvents="none">
      <View className="h-px bg-border">
        <View className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </View>
      <View className="bg-secondary">
        <View className="flex-row items-center justify-center px-4 pt-1 pb-4">
          <Text className="text-xs text-secondary-foreground">
            {stateLabel} {activeItem.label}... {percent}%
          </Text>
        </View>
      </View>
    </View>
  );
}
