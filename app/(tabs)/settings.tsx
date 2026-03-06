import React, { useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";
import { useAtom } from "jotai";
import { alert } from "@/lib/confirm";
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
  type ThemePreference,
} from "@/stores/settings";
import { getVersionString } from "@/lib/version";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsScreen() {
  const [activeTheme, setActiveTheme] = useAtom(themeAtom);
  const [showRomaji, setShowRomaji] = useAtom(showRomajiAtom);
  const [showPitchAccent, setShowPitchAccent] = useAtom(showPitchAccentAtom);
  const [showPitchAccentType, setShowPitchAccentType] = useAtom(showPitchAccentTypeAtom);
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

      <View className="items-center pt-4 pb-8 border-t border-border mt-auto">
        <Text className="text-[10px] font-medium text-muted-foreground">{getVersionString()}</Text>
      </View>
    </ScrollView>
  );
}
