import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { useSync } from "@/db/sync-provider";

const TAB_BAR_HEIGHT = 49;

const STATE_LABELS: Record<string, string> = {
  downloading: "Downloading",
  importing: "Importing",
  pending: "Preparing",
};

export function BackgroundDownloadBanner() {
  const { backgroundStatus } = useDatabase();
  const { syncStatus, syncProgress } = useSync();
  const insets = useSafeAreaInsets();

  const isSyncing = syncStatus === "syncing";
  const activeItem = backgroundStatus.find(
    (item) => item.state === "downloading" || item.state === "importing",
  );
  const hasActivity = isSyncing || !!activeItem;
  const targetPercent = isSyncing
    ? Math.round(syncProgress * 100)
    : Math.round((activeItem?.progress ?? 0) * 100);

  // Smoothly animate displayPercent toward targetPercent via interval
  const [displayPercent, setDisplayPercent] = useState(0);
  const targetRef = useRef(0);
  const displayRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasActivity) {
      targetRef.current = 0;
      displayRef.current = 0;
      setDisplayPercent(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    targetRef.current = targetPercent;

    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => {
        const target = targetRef.current;
        const current = displayRef.current;
        if (current < target) {
          // Move 1% per tick toward target
          const next = Math.min(current + 1, target);
          displayRef.current = next;
          setDisplayPercent(next);
        }
      }, 30);
    }

    // If target jumped ahead of display, let the interval catch up naturally
    // But if target jumped WAY ahead (>30%), snap closer to avoid slow crawl
    if (targetPercent - displayRef.current > 30) {
      displayRef.current = targetPercent - 10;
      setDisplayPercent(displayRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [targetPercent, hasActivity]);

  if (!hasActivity) return null;

  const isWeb = Platform.OS === "web";
  const label = isSyncing
    ? "Syncing..."
    : `${STATE_LABELS[activeItem!.state] ?? "Preparing"} ${activeItem!.label}... ${Math.round(activeItem!.progress * 100)}%`;

  return (
    <View
      style={{
        position: "absolute",
        ...(isWeb
          ? { top: 56, left: 20, right: 20 }
          : { bottom: insets.bottom > 0 ? 0 : TAB_BAR_HEIGHT, left: 0, right: 0 }),
      }}
      pointerEvents="box-none"
    >
      <View className="h-px bg-border" pointerEvents="none">
        <View className="h-full bg-primary" style={{ width: `${displayPercent}%` }} />
      </View>
      <View className={isWeb ? "" : "bg-secondary"} pointerEvents="none">
        <View className="flex-row items-start justify-center px-4 pt-1 pb-4">
          <Text className="text-xs text-secondary-foreground">{label}</Text>
        </View>
      </View>
    </View>
  );
}
