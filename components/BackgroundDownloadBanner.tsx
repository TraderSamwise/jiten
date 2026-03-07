import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSegments } from "expo-router";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { useSync } from "@/db/sync-provider";
import { useAuth } from "@/lib/auth";
import { getLastUser } from "@/lib/last-user";

const TAB_BAR_HEIGHT = 49;

const STATE_LABELS: Record<string, string> = {
  downloading: "Downloading",
  importing: "Importing",
  pending: "Preparing",
};

export function BackgroundDownloadBanner() {
  const { backgroundStatus } = useDatabase();
  const { syncStatus, syncProgress, syncLabel, lastError } = useSync();
  const insets = useSafeAreaInsets();
  const segments = useSegments();

  const onAuthScreen = segments[0] === "sign-in" || segments[0] === "sign-up";

  const isSyncing = syncStatus === "syncing";
  const activeItem = backgroundStatus.find(
    (item) => item.state === "downloading" || item.state === "importing",
  );

  // Show error state briefly when sync fails
  const [showError, setShowError] = useState(false);
  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (prevSyncStatus.current === "syncing" && syncStatus === "error") {
      setShowError(true);
      const timer = setTimeout(() => setShowError(false), 15_000);
      return () => clearTimeout(timer);
    }
    prevSyncStatus.current = syncStatus;
  }, [syncStatus]);

  // Show "signed out" notice for users whose session expired
  const { isSignedIn, isLoaded } = useAuth();
  const [showSignedOut, setShowSignedOut] = useState(false);
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    let cancelled = false;
    getLastUser().then((lastUser) => {
      if (cancelled || !lastUser) return;
      setShowSignedOut(true);
      const timer = setTimeout(() => setShowSignedOut(false), 30_000);
      return () => clearTimeout(timer);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);
  // Dismiss signed-out notice when other activity starts
  if (showSignedOut && (isSyncing || !!activeItem)) {
    setShowSignedOut(false);
  }

  const hasActivity = isSyncing || showError || showSignedOut || !!activeItem;
  const targetPercent =
    showError || showSignedOut
      ? 100
      : isSyncing
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

  if (!hasActivity || onAuthScreen) return null;

  const isWeb = Platform.OS === "web";
  const errorDetail = lastError
    ? lastError.length > 80
      ? lastError.slice(0, 80) + "..."
      : lastError
    : null;
  const label = showError
    ? `Sync failed${errorDetail ? ` — ${errorDetail}` : ""}`
    : showSignedOut
      ? "Signed out — Sign in to sync"
      : isSyncing
        ? `Syncing${syncLabel ? ` — ${syncLabel}` : "..."}`
        : `${STATE_LABELS[activeItem!.state] ?? "Preparing"} ${activeItem!.label}... ${Math.round(activeItem!.progress * 100)}%`;

  const barColor = showError ? "bg-destructive" : showSignedOut ? "bg-blue-500" : "bg-primary";

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
        <View className={`h-full ${barColor}`} style={{ width: `${displayPercent}%` }} />
      </View>
      <View className={isWeb ? "" : "bg-secondary"} pointerEvents="none">
        <View className="flex-row items-start justify-center px-4 pt-1 pb-4">
          <Text
            className={`text-xs ${showError ? "text-destructive" : showSignedOut ? "text-blue-500" : "text-secondary-foreground"}`}
          >
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}
