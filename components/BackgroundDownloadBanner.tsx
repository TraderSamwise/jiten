import React from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";

const TAB_BAR_HEIGHT = 49;

const STATE_LABELS: Record<string, string> = {
  downloading: "Downloading",
  importing: "Importing",
  pending: "Preparing",
};

export function BackgroundDownloadBanner() {
  const { backgroundStatus } = useDatabase();
  const insets = useSafeAreaInsets();

  // Find the active item (first non-ready, non-error, non-pending)
  const activeItem = backgroundStatus.find(
    (item) => item.state === "downloading" || item.state === "importing",
  );

  if (!activeItem) return null;

  const percent = Math.round((activeItem.progress ?? 0) * 100);
  const stateLabel = STATE_LABELS[activeItem.state] ?? "Preparing";

  const isWeb = Platform.OS === "web";

  return (
    <View
      style={{
        position: "absolute",
        ...(isWeb
          ? { top: 0, left: 0, right: 0 }
          : { bottom: insets.bottom > 0 ? 0 : TAB_BAR_HEIGHT, left: 0, right: 0 }),
      }}
      pointerEvents="box-none"
    >
      <View className="h-px bg-border" pointerEvents="none">
        <View className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </View>
      <View className="bg-secondary" pointerEvents="none">
        <View className="flex-row items-start justify-center px-4 pt-1 pb-4">
          <Text className="text-xs text-secondary-foreground">
            {stateLabel} {activeItem.label}... {percent}%
          </Text>
        </View>
      </View>
    </View>
  );
}
