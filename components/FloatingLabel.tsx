import React, { useEffect, useState } from "react";
import { useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";

const MAX_W = 200;
const SCREEN_PAD = 16;

interface FloatingLabelProps {
  text: string;
  screenX: number;
  screenY: number;
  onDone: () => void;
}

/**
 * A floating text label that drifts upward and fades out.
 * Used as a reveal animation (e.g. showing a definition after a match).
 */
export function FloatingLabel({ text, screenX, screenY, onDone }: FloatingLabelProps) {
  const { width: screenWidth } = useWindowDimensions();
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const [textW, setTextW] = useState<number | null>(null);

  useEffect(() => {
    if (textW === null) return;
    opacity.value = 1;
    translateY.value = withTiming(-48, { duration: 3000, easing: Easing.out(Easing.quad) });
    opacity.value = withTiming(0, { duration: 3000, easing: Easing.in(Easing.quad) });
    const timer = setTimeout(onDone, 3100);
    return () => clearTimeout(timer);
  }, [textW]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const w = textW ?? MAX_W;
  const idealLeft = screenX - w / 2;
  const clampedLeft = Math.max(SCREEN_PAD, Math.min(idealLeft, screenWidth - SCREEN_PAD - w));

  return (
    <Animated.View
      style={[
        { position: "absolute", top: screenY - 12, left: clampedLeft, zIndex: 50 },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <Text
        className="text-sm font-medium text-primary text-center"
        style={{ maxWidth: MAX_W }}
        numberOfLines={1}
        onLayout={textW === null ? (e) => setTextW(e.nativeEvent.layout.width) : undefined}
      >
        {text}
      </Text>
    </Animated.View>
  );
}
