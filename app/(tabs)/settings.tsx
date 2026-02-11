import React, { useState, useEffect } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { loadTheme, saveTheme, applyTheme, type ThemePreference } from "@/lib/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsScreen() {
  const [activeTheme, setActiveTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    loadTheme().then(setActiveTheme);
  }, []);

  function handleThemeChange(theme: ThemePreference) {
    applyTheme(theme);
    saveTheme(theme);
    setActiveTheme(theme);
  }

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <Card className="mb-4">
        <CardTitle>Jiten</CardTitle>
        <CardDescription>Japanese-English Dictionary</CardDescription>
        <Text className="mt-2 text-xs text-muted-foreground">Version 0.1.0</Text>
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
    </View>
  );
}
