import React, { useEffect, useCallback } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";

interface BannerProps {
  message: string;
  severity: "info" | "warning" | "error" | "success";
  visible: boolean;
  autoDismissMs?: number;
  onDismiss?: () => void;
}

const SEVERITY_COLORS = {
  info: { bg: "#3b82f6", text: "#ffffff" },
  warning: { bg: "#f59e0b", text: "#1c1917" },
  error: { bg: "#ef4444", text: "#ffffff" },
  success: { bg: "#22c55e", text: "#ffffff" },
} as const;

export function Banner({
  message,
  severity,
  visible,
  autoDismissMs = 4000,
  onDismiss,
}: BannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  const dismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: 300 });
      opacity.value = withTiming(1, { duration: 300 });

      if (autoDismissMs > 0 && onDismiss) {
        const timer = setTimeout(dismiss, autoDismissMs);
        return () => clearTimeout(timer);
      }
    } else {
      translateY.value = withTiming(-100, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [visible, autoDismissMs]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const colors = SEVERITY_COLORS[severity];

  if (!visible && opacity.value === 0) return null;

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: insets.top + 4,
          left: 16,
          right: 16,
          zIndex: 1000,
        },
        animatedStyle,
      ]}
    >
      <Pressable onPress={dismiss}>
        <View
          style={{
            backgroundColor: colors.bg,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{message}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
