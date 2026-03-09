import React, { useEffect, useState } from "react";
import { View, Platform, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDatabase } from "@/db/provider";
import { getVersionString, getVersionCode } from "@/lib/version";

/** On web, gate screens render inside the 960px container but need to
 *  break out to fill the full viewport (no navbar backdrop is mounted). */
function FullScreenGate({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") {
    return <View className="flex-1 items-center justify-center bg-background">{children}</View>;
  }
  return (
    <View
      style={{
        position: "fixed" as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex" as any,
        alignItems: "center",
        justifyContent: "center",
      }}
      className="bg-background"
    >
      {children}
    </View>
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export function DictDownloadGate({ children }: { children: React.ReactNode }) {
  const { dictDb, isReady, isDownloaded, downloadStatus, startDownload, retryManifest } =
    useDatabase();

  // On web, keep the gate overlay visible for one extra frame after the DB is ready
  // so children (tabs) can mount underneath without a flash of empty black screen.
  const ready = isReady && isDownloaded && !!dictDb;
  const [gateVisible, setGateVisible] = useState(true);
  useEffect(() => {
    if (!ready) {
      setGateVisible(true);
      return;
    }
    // Let children render one frame under the overlay, then drop it
    const raf = requestAnimationFrame(() => setGateVisible(false));
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  if (!isReady) {
    return (
      <FullScreenGate>
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading dictionary...</Text>
      </FullScreenGate>
    );
  }

  if (isDownloaded && dictDb) {
    return (
      <>
        {children}
        {Platform.OS === "web" && gateVisible && (
          <FullScreenGate>
            <ActivityIndicator size="large" />
            <Text className="mt-4 text-muted-foreground">Preparing dictionary...</Text>
          </FullScreenGate>
        )}
      </>
    );
  }

  // DB was released to another tab — will reacquire on visibility change
  if (isDownloaded && !dictDb) {
    return (
      <FullScreenGate>
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Reconnecting...</Text>
      </FullScreenGate>
    );
  }

  return (
    <FullScreenGate>
      <Card className="w-full max-w-sm items-center p-6 mx-6">
        <Text className="text-4xl mb-2">辞典</Text>
        <Text className="text-xl font-semibold text-foreground mb-1">Jiten</Text>
        <Text className="text-sm text-muted-foreground text-center mb-6">
          Japanese dictionary, reader, and flashcards
        </Text>

        {downloadStatus.state === "checking" && (
          <>
            <ActivityIndicator size="small" />
            <Text className="mt-2 text-sm text-muted-foreground">
              Checking for dictionary data...
            </Text>
          </>
        )}

        {downloadStatus.state === "needs-download" && (
          <>
            <Text className="text-sm text-muted-foreground text-center mb-4">
              {downloadStatus.isUpdate
                ? "A dictionary update is available with new features and data."
                : "The dictionary database needs to be downloaded before you can search."}
            </Text>
            <Button
              label={
                downloadStatus.isUpdate
                  ? `Update Dictionary (${formatBytes(downloadStatus.manifest.compressedSizeBytes ?? downloadStatus.manifest.sizeBytes)})`
                  : `Download Dictionary (${formatBytes(downloadStatus.manifest.miniCompressedSizeBytes || downloadStatus.manifest.miniSizeBytes || downloadStatus.manifest.compressedSizeBytes || downloadStatus.manifest.sizeBytes)})`
              }
              onPress={startDownload}
            />
          </>
        )}

        {downloadStatus.state === "downloading" && (
          <>
            <View className="w-full h-2 bg-secondary rounded-full mb-2 overflow-hidden">
              <View
                className="h-full bg-primary rounded-full"
                style={{
                  width: `${Math.round(downloadStatus.progress * 100)}%`,
                }}
              />
            </View>
            <Text className="text-sm text-muted-foreground">
              Downloading... {Math.round(downloadStatus.progress * 100)}%
            </Text>
          </>
        )}

        {downloadStatus.state === "preparing" && (
          <>
            <ActivityIndicator size="small" />
            <Text className="mt-2 text-sm text-muted-foreground">Preparing dictionary...</Text>
          </>
        )}

        {downloadStatus.state === "error" && downloadStatus.message === "opfs-lock" && (
          <>
            <Text className="text-sm text-destructive text-center mb-2">
              The database is locked by another tab.
            </Text>
            <Text className="text-sm text-muted-foreground text-center mb-4">
              Close any other Jiten tabs, then tap Retry. If that doesn't work, close all tabs and
              reopen.
            </Text>
            <Button label="Retry" onPress={() => window.location.reload()} />
          </>
        )}

        {downloadStatus.state === "error" && downloadStatus.message !== "opfs-lock" && (
          <>
            <Text className="text-sm text-destructive text-center mb-4">
              {downloadStatus.message}
            </Text>
            <Button label="Retry" onPress={retryManifest} />
            <Text className="text-xs text-muted-foreground text-center mt-4">
              {getVersionString()} ({getVersionCode()})
            </Text>
          </>
        )}
      </Card>
    </FullScreenGate>
  );
}
