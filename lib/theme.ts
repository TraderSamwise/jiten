import { Appearance } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";

export type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "theme-preference";

export async function loadTheme(): Promise<ThemePreference> {
  const value = await AsyncStorage.getItem(THEME_KEY);
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export async function saveTheme(theme: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(THEME_KEY, theme);
}

let systemListener: ReturnType<typeof Appearance.addChangeListener> | null = null;

export function applyTheme(theme: ThemePreference): void {
  // Clean up any previous system listener
  systemListener?.remove();
  systemListener = null;

  if (theme === "system") {
    // Resolve system preference and set explicitly to keep nav and content in sync
    const resolved = Appearance.getColorScheme() ?? "light";
    colorScheme.set(resolved);

    // Listen for OS theme changes while in system mode
    systemListener = Appearance.addChangeListener(({ colorScheme: newScheme }) => {
      colorScheme.set(newScheme ?? "light");
    });
  } else {
    colorScheme.set(theme);
  }
}
