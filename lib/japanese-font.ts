import { Platform } from "react-native";

const LIGHT_THRESHOLD = 48;

/**
 * Returns platform-specific font style for Japanese text.
 * Large text (≥48px) gets a lighter weight for a cleaner look.
 * Small text stays at default weight for readability.
 */
export function japaneseFontStyle(fontSize: number): {
  fontFamily?: string;
  fontWeight?: "300" | "400";
} {
  if (fontSize >= LIGHT_THRESHOLD) {
    return Platform.select({
      ios: { fontFamily: "Hiragino Sans", fontWeight: "300" as const },
      android: { fontFamily: "sans-serif-light" },
      default: { fontWeight: "300" as const },
    })!;
  }
  return {};
}
