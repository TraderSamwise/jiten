import React, { useCallback, useState } from "react";
import { Platform, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { RefreshCw } from "@/lib/icons";
import { useSync } from "@/db/sync-provider";
import { SyncChoiceModal } from "@/components/SyncChoiceModal";

interface SyncButtonProps {
  /** Called after sync completes to reload screen data */
  onSyncComplete?: () => Promise<void>;
}

/**
 * Web-only sync button with 3 visual states:
 * - Dirty (unsynced local changes): hollow icon
 * - Syncing: spinning icon
 * - Clean (synced): filled icon
 */
export function SyncButton({ onSyncComplete }: SyncButtonProps) {
  const { triggerSync, isDirty, syncWithChoice, syncStatus } = useSync();
  const [showSyncChoice, setShowSyncChoice] = useState(false);
  const rotation = useSharedValue(0);
  const isSyncing = syncStatus === "syncing";
  const dirty = isDirty;

  // Start/stop spin based on sync status
  React.useEffect(() => {
    if (isSyncing) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = withTiming(0, { duration: 200 });
    }
  }, [isSyncing]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handlePress = useCallback(async () => {
    if (syncStatus === "disabled" || isSyncing) return;
    if (isDirty) {
      setShowSyncChoice(true);
      return;
    }
    await triggerSync();
    await onSyncComplete?.();
  }, [syncStatus, isSyncing, isDirty, triggerSync, onSyncComplete]);

  const handleSyncChoice = useCallback(
    async (choice: "merge" | "use-cloud" | "use-local") => {
      setShowSyncChoice(false);
      await syncWithChoice(choice);
      await onSyncComplete?.();
    },
    [syncWithChoice, onSyncComplete],
  );

  if (Platform.OS !== "web" || syncStatus === "disabled") return null;

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={{
          position: "absolute",
          top: 53,
          right: 4,
          zIndex: 50,
        }}
        className="p-1.5 rounded-md hover:bg-muted/80 active:bg-muted"
      >
        <Animated.View style={animatedStyle}>
          <RefreshCw
            size={16}
            className="text-muted-foreground"
            fill="none"
            strokeWidth={2}
            style={{ opacity: dirty ? 0.5 : 1 }}
          />
        </Animated.View>
      </Pressable>

      <SyncChoiceModal
        visible={showSyncChoice}
        onChoice={handleSyncChoice}
        title="Unsaved Local Changes"
        description="You have local changes that haven't been synced yet. How should we handle the refresh?"
      />
    </>
  );
}
