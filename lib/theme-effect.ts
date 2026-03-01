import { useEffect } from "react";
import { Appearance } from "react-native";
import { useAtomValue } from "jotai";
import { colorScheme } from "nativewind";
import { themeAtom } from "@/stores/settings";

export function useThemeEffect() {
  const theme = useAtomValue(themeAtom);

  useEffect(() => {
    if (theme === "system") {
      const resolved = Appearance.getColorScheme() ?? "light";
      colorScheme.set(resolved);

      const listener = Appearance.addChangeListener(({ colorScheme: s }) => {
        colorScheme.set(s ?? "light");
      });
      return () => listener.remove();
    } else {
      colorScheme.set(theme);
    }
  }, [theme]);
}
