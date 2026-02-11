import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDatabase } from "@/db/provider";

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export function DictDownloadGate({ children }: { children: React.ReactNode }) {
  const { dictDb, isReady, isDownloaded, downloadStatus, startDownload, retryManifest } =
    useDatabase();

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  if (isDownloaded && dictDb) {
    return <>{children}</>;
  }

  // DB was released to another tab — will reacquire on visibility change
  if (isDownloaded && !dictDb) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Reconnecting...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm items-center p-6">
        <Text className="text-4xl mb-2">辞典</Text>
        <Text className="text-xl font-semibold text-foreground mb-1">Jiten</Text>
        <Text className="text-sm text-muted-foreground text-center mb-6">
          Japanese dictionary with flashcards
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
                  ? `Update Dictionary (${formatBytes(downloadStatus.manifest.sizeBytes)})`
                  : `Download Dictionary (${formatBytes(downloadStatus.manifest.sizeBytes)})`
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
          </>
        )}
      </Card>
    </View>
  );
}
