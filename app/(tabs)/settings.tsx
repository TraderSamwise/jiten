import React, { useState } from "react";
import { Platform, View } from "react-native";
import { useAtom } from "jotai";
import { alert } from "@/lib/confirm";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { themeAtom, type ThemePreference } from "@/stores/settings";
import { getVersionString } from "@/lib/version";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsScreen() {
  const [activeTheme, setActiveTheme] = useAtom(themeAtom);
  const [isUpdating, setIsUpdating] = useState(false);

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

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <Card className="mb-4">
        <CardTitle>Jiten</CardTitle>
        <CardDescription>Japanese-English Dictionary</CardDescription>
      </Card>

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
        <CardTitle className="text-base">Updates</CardTitle>
        <Separator className="my-2" />
        <Button
          variant="outline"
          size="sm"
          label={isUpdating ? "Checking..." : "Check for Updates"}
          onPress={handleCheckForUpdates}
          disabled={isUpdating}
        />
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

      <View className="items-center pt-4 pb-8 border-t border-border mt-auto">
        <Text className="text-[10px] font-medium text-muted-foreground">{getVersionString()}</Text>
      </View>
    </View>
  );
}
