import { useWindowDimensions, Platform } from "react-native";

const WEB_MAX_WIDTH = 960;

export function useContainerWidth() {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" ? Math.min(width, WEB_MAX_WIDTH) : width;
}
