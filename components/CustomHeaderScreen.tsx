import React, { forwardRef } from "react";
import { ActivityIndicator, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_BACKDROP_COLORS, WEB_CUSTOM_HEADER_TOP } from "@/lib/navigation";

export function useWebBackdrop(webTop: number = WEB_CUSTOM_HEADER_TOP) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();

  const webBgStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: isDark ? WEB_BACKDROP_COLORS.dark : WEB_BACKDROP_COLORS.light,
        } as const)
      : undefined;

  const topPadding = Platform.OS === "web" ? { paddingTop: webTop } : { paddingTop: insets.top };

  return { webBgStyle, topPadding, insets, isDark };
}

interface CustomHeaderScreenProps {
  children: React.ReactNode;
  webTop?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
  onTouchStart?: () => void;
}

export const CustomHeaderScreen = forwardRef<View, CustomHeaderScreenProps>(
  ({ children, webTop, style, className = "flex-1 bg-background", onTouchStart }, ref) => {
    const { webBgStyle, topPadding } = useWebBackdrop(webTop);
    return (
      <View
        ref={ref}
        className={className}
        style={[topPadding, webBgStyle, style]}
        onTouchStart={onTouchStart}
      >
        {children}
      </View>
    );
  },
);

interface HeaderPlaceholderProps {
  py?: "py-2" | "py-3";
  spacerHeight?: number;
}

export function HeaderPlaceholder({ py = "py-3", spacerHeight = 32 }: HeaderPlaceholderProps) {
  const { webBgStyle } = useWebBackdrop();
  return (
    <View
      className={`${py} ${Platform.OS === "web" ? "border-b border-border" : ""}`}
      style={webBgStyle}
    >
      <View style={{ height: spacerHeight }} />
    </View>
  );
}

interface NavigatingOverlayProps {
  visible: boolean;
  py?: "py-2" | "py-3";
  spacerHeight?: number;
  webTop?: number;
}

export function NavigatingOverlay({
  visible,
  py = "py-3",
  spacerHeight = 32,
  webTop,
}: NavigatingOverlayProps) {
  const { webBgStyle, topPadding } = useWebBackdrop(webTop);
  if (!visible) return null;
  return (
    <View className="absolute inset-0 z-50 bg-background" style={[topPadding, webBgStyle]}>
      <HeaderPlaceholder py={py} spacerHeight={spacerHeight} />
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    </View>
  );
}
