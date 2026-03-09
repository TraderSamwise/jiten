import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useAtom } from "jotai";
import { useRouter } from "expo-router";
import { alert, confirm } from "@/lib/confirm";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PitchAccent } from "@/components/PitchAccent";
import {
  themeAtom,
  showRomajiAtom,
  showPitchAccentAtom,
  showPitchAccentTypeAtom,
  dayResetHourAtom,
  type ThemePreference,
} from "@/stores/settings";
import { getVersionString } from "@/lib/version";
import { useAuth, useUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { useSync } from "@/db/sync-provider";
import { DeleteDataModal } from "@/components/DeleteDataModal";
import { HardSyncModal } from "@/components/HardSyncModal";
import { useUserDb } from "@/db/user-provider";
import { attemptBackup, importBackup, type ImportResult } from "@/lib/data-backup";
import { saveAndShareFile } from "@/lib/file-transfer";
import { ProgressBar } from "@/components/ProgressBar";
import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const HAS_AUTH = !!env.CLERK_PUBLISHABLE_KEY;

function AccountCard() {
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const router = useRouter();

  if (!isSignedIn) {
    return (
      <Card className="mb-4">
        <CardTitle className="text-base">Account</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-muted-foreground mb-3">Sign in to sync across devices</Text>
        <View className="flex-row gap-2">
          <Button
            variant="default"
            size="sm"
            label="Sign In"
            onPress={() => router.push("/sign-in")}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            label="Sign Up"
            onPress={() => router.push("/sign-up")}
            className="flex-1"
          />
        </View>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardTitle className="text-base">Account</CardTitle>
      <Separator className="my-2" />
      <Text className="text-sm text-foreground mb-1">
        {user?.primaryEmailAddress?.emailAddress ?? user?.id ?? "Signed in"}
      </Text>
      <Button variant="outline" size="sm" label="Sign Out" onPress={() => signOut()} />
    </Card>
  );
}

export default function SettingsScreen() {
  const [activeTheme, setActiveTheme] = useAtom(themeAtom);
  const [showRomaji, setShowRomaji] = useAtom(showRomajiAtom);
  const [showPitchAccent, setShowPitchAccent] = useAtom(showPitchAccentAtom);
  const [showPitchAccentType, setShowPitchAccentType] = useAtom(showPitchAccentTypeAtom);
  const [dayResetHour, setDayResetHour] = useAtom(dayResetHourAtom);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showHardSyncModal, setShowHardSyncModal] = useState(false);
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { syncStatus, triggerSync } = useSync();
  const userDb = useUserDb();
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "done" | "error">("idle");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importLabel, setImportLabel] = useState("");

  function handleThemeChange(theme: ThemePreference) {
    setActiveTheme(theme);
  }

  async function handleCheckForUpdates() {
    if (Platform.OS === "web") {
      alert("Not available", "OTA updates are only available on native builds.");
      return;
    }
    if (__DEV__) {
      alert("Development mode", "Update checking is disabled in development mode.");
      return;
    }

    setIsUpdating(true);
    try {
      const Updates = await import("expo-updates");
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        alert("Update found", "Downloading update...");
        await Updates.fetchUpdateAsync();
        alert("Update downloaded", "App will restart to apply the update.");
        setTimeout(async () => {
          try {
            await Updates.reloadAsync();
          } catch {
            alert("Restart failed", "Please restart the app manually.");
          }
        }, 1000);
      } else {
        const updateId = Updates.updateId || "embedded";
        alert(
          "Up to date",
          `No updates available.\n\nVersion: ${getVersionString()}\nUpdate ID: ${updateId}`,
        );
      }
    } catch (e: unknown) {
      alert("Update check failed", e instanceof Error ? e.message : String(e));
    } finally {
      setIsUpdating(false);
    }
  }

  const pitchExamples: { label: string; desc: string; reading: string; pitch: number }[] = [
    { label: "Heiban (flat)", desc: "LH...H — pitch stays high", reading: "さくら", pitch: 0 },
    {
      label: "Atamadaka (head high)",
      desc: "HLL... — drops after first mora",
      reading: "いのち",
      pitch: 1,
    },
    {
      label: "Nakadaka (middle drop)",
      desc: "LH...HL — drops mid-word",
      reading: "たまご",
      pitch: 2,
    },
    {
      label: "Odaka (tail drop)",
      desc: "LHH...H↓ — drops after last mora",
      reading: "おとこ",
      pitch: 3,
    },
  ];

  return (
    <ScrollView className="flex-1 bg-background px-4 pt-4">
      <Card className="mb-4">
        <CardTitle>Jiten</CardTitle>
        <CardDescription>Japanese-English Dictionary</CardDescription>
      </Card>

      {HAS_AUTH && <AccountCard />}

      <Card className="mb-4">
        <CardTitle className="text-base">Theme</CardTitle>
        <Separator className="my-2" />
        <View className="flex-row gap-2">
          {THEME_OPTIONS.map((opt) => {
            const active = activeTheme === opt.value;
            return (
              <Button
                key={opt.value}
                variant={active ? "default" : "outline"}
                size="sm"
                label={opt.label}
                onPress={() => handleThemeChange(opt.value)}
                className="flex-1"
              />
            );
          })}
        </View>
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Display</CardTitle>
        <Separator className="my-2" />
        <View className="flex-row items-center justify-between py-2">
          <Text className="text-sm text-foreground">Show Romaji</Text>
          <Switch value={showRomaji} onValueChange={setShowRomaji} />
        </View>
        <View className="flex-row items-center justify-between py-2">
          <Text className="text-sm text-foreground">Show Pitch Accent</Text>
          <Switch value={showPitchAccent} onValueChange={setShowPitchAccent} />
        </View>
        <View className="flex-row items-center justify-between py-2">
          <Text className="text-sm text-foreground">Show Pitch Accent Type</Text>
          <Switch value={showPitchAccentType} onValueChange={setShowPitchAccentType} />
        </View>
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Study</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-foreground mb-1">Day Reset Time</Text>
        <Text className="text-xs text-muted-foreground mb-2">
          When your study day resets. Affects streaks, stats, and review marks.
        </Text>
        <View className="flex-row items-center gap-3">
          <Pressable
            className="w-8 h-8 items-center justify-center rounded border border-border"
            onPress={() => setDayResetHour(Math.max(0, dayResetHour - 1))}
          >
            <Text className="text-foreground text-base">-</Text>
          </Pressable>
          <Text className="text-sm text-foreground min-w-[72px] text-center">
            {dayResetHour === 0 ? "12:00 AM" : `${dayResetHour}:00 AM`}
          </Text>
          <Pressable
            className="w-8 h-8 items-center justify-center rounded border border-border"
            onPress={() => setDayResetHour(Math.min(6, dayResetHour + 1))}
          >
            <Text className="text-foreground text-base">+</Text>
          </Pressable>
        </View>
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Updates</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-muted-foreground mb-2">{getVersionString()}</Text>
        {Platform.OS !== "web" && (
          <Button
            variant="outline"
            size="sm"
            label={isUpdating ? "Checking..." : "Check for Updates"}
            onPress={handleCheckForUpdates}
            disabled={isUpdating}
          />
        )}
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Pitch Accent Guide</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-muted-foreground mb-3">
          The line above kana shows pitch patterns. High = high pitch, low = low pitch. The number
          in brackets is the downstep position (mora where pitch drops).
        </Text>
        {pitchExamples.map((ex) => (
          <View key={ex.label} className="mb-3">
            <Text className="text-sm font-medium text-foreground">{ex.label}</Text>
            <Text className="text-xs text-muted-foreground mb-1">{ex.desc}</Text>
            <PitchAccent accent={{ reading: ex.reading, pitchNumber: ex.pitch }} forceShow />
          </View>
        ))}
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Dictionary Data</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-muted-foreground">
          Powered by JMdict/EDICT, a property of the Electronic Dictionary Research and Development
          Group (EDRDG). Licensed under CC BY-SA 4.0.
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          Pitch accent data from Kanjium. Licensed under CC BY-SA 4.0.
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          Word audio from Kanji Alive. Licensed under CC BY 4.0.
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          Word audio from Tofugu. Licensed under CC BY-SA 4.0.
        </Text>
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Spaced Repetition</CardTitle>
        <Separator className="my-2" />
        <Text className="text-sm text-muted-foreground">
          Uses the FSRS (Free Spaced Repetition Scheduler) algorithm for optimized review
          scheduling.
        </Text>
      </Card>

      <Card className="mb-4">
        <CardTitle className="text-base">Data</CardTitle>
        <Separator className="my-2" />
        {isSignedIn && (
          <>
            <Button
              variant="outline"
              size="sm"
              label={syncStatus === "syncing" ? "Syncing..." : "Sync Now"}
              onPress={() => triggerSync()}
              disabled={syncStatus === "syncing"}
              className="mb-2"
            />
            <Button
              variant="outline"
              size="sm"
              label="Hard Sync"
              onPress={() => setShowHardSyncModal(true)}
              className="mb-2"
            />
          </>
        )}
        {userDb && (
          <>
            <Button
              variant="outline"
              size="sm"
              label={
                exportStatus === "exporting"
                  ? "Exporting..."
                  : exportStatus === "done"
                    ? "Exported!"
                    : "Export Data"
              }
              disabled={exportStatus === "exporting"}
              onPress={async () => {
                setExportStatus("exporting");
                try {
                  const backup = await attemptBackup(userDb);
                  const json = JSON.stringify(
                    {
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      tables: backup.tables,
                      succeeded: backup.succeeded,
                      failed: backup.failed,
                    },
                    null,
                    2,
                  );
                  const date = new Date().toISOString().slice(0, 10);
                  await saveAndShareFile(`jiten-backup-${date}.json`, json, "application/json");
                  setExportStatus("done");
                  setTimeout(() => setExportStatus("idle"), 2000);
                } catch {
                  setExportStatus("error");
                  alert("Export failed", "Could not export data. Please try again.");
                  setTimeout(() => setExportStatus("idle"), 2000);
                }
              }}
              className="mb-2"
            />
            <Button
              variant="outline"
              size="sm"
              label={
                importStatus === "importing"
                  ? "Importing..."
                  : importStatus === "done"
                    ? `Imported ${importResult?.totalRows ?? 0} rows`
                    : "Import Data"
              }
              disabled={importStatus === "importing"}
              onPress={async () => {
                try {
                  const pickerResult = await DocumentPicker.getDocumentAsync({
                    type: ["application/json"],
                    copyToCacheDirectory: true,
                  });

                  if (pickerResult.canceled || pickerResult.assets.length === 0) return;

                  const asset = pickerResult.assets[0];

                  let content: string;
                  if (Platform.OS === "web") {
                    const response = await fetch(asset.uri);
                    content = await response.text();
                  } else {
                    const { readAsStringAsync, EncodingType } =
                      await import("expo-file-system/legacy");
                    content = await readAsStringAsync(asset.uri, {
                      encoding: EncodingType.UTF8,
                    });
                  }

                  setImportStatus("importing");
                  setImportProgress(0);
                  setImportLabel("");

                  const result = await importBackup(userDb, content, (pct, label) => {
                    setImportProgress(pct);
                    setImportLabel(label);
                  });
                  setImportResult(result);
                  setImportStatus("done");
                  if (result.failed.length > 0) {
                    alert(
                      "Partial import",
                      `Imported ${result.succeeded.length} tables (${result.totalRows} rows).\nFailed: ${result.failed.map((f) => f.table).join(", ")}`,
                    );
                  }
                } catch (err) {
                  setImportStatus("error");
                  alert(
                    "Import failed",
                    err instanceof Error ? err.message : "Invalid backup file.",
                  );
                  setTimeout(() => setImportStatus("idle"), 2000);
                }
              }}
              className="mb-2"
            />
            {importStatus === "importing" && (
              <View className="mb-2">
                <ProgressBar percent={importProgress} />
                {!!importLabel && (
                  <Text className="text-xs text-muted-foreground mt-1">{importLabel}</Text>
                )}
              </View>
            )}
            {importStatus === "done" && importResult && (
              <Text className="text-xs text-muted-foreground mb-2">
                {importResult.succeeded.length > 0 &&
                  `Restored: ${importResult.succeeded.join(", ")}`}
                {importResult.failed.length > 0 &&
                  `\nFailed: ${importResult.failed.map((f) => f.table).join(", ")}`}
                {importResult.skipped.length > 0 &&
                  `\nSkipped (empty): ${importResult.skipped.join(", ")}`}
              </Text>
            )}
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          label="Reset Dictionary"
          onPress={async () => {
            const proceed = await confirm(
              "Reset Dictionary?",
              "This will delete the downloaded dictionary and re-download it on next launch. Your user data will not be affected.",
            );
            if (!proceed) return;
            try {
              await SQLite.deleteDatabaseAsync("dictionary.db");
              await SQLite.deleteDatabaseAsync("dictionary-audio.db");
              await SQLite.deleteDatabaseAsync("dictionary-extended.db");
            } catch {}
            await AsyncStorage.multiRemove([
              "dict-db-version",
              "dict-db-format",
              "dict-audio-version",
              "ext-db-version",
            ]);
            if (Platform.OS === "web") {
              window.location.reload();
            } else {
              const Updates = await import("expo-updates");
              await Updates.reloadAsync();
            }
          }}
          className="mb-2"
        />
        <Button
          variant="destructive"
          size="sm"
          label="Delete Data"
          onPress={() => setShowDeleteModal(true)}
        />
      </Card>

      <HardSyncModal visible={showHardSyncModal} onClose={() => setShowHardSyncModal(false)} />

      <DeleteDataModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        isSignedIn={!!isSignedIn}
        deleteAccount={isSignedIn && user ? () => user.delete() : undefined}
      />

      <View className="items-center pt-4 pb-8 border-t border-border mt-auto">
        <Text className="text-[10px] font-medium text-muted-foreground">{getVersionString()}</Text>
      </View>
    </ScrollView>
  );
}
