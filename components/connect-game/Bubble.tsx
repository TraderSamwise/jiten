import React, { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import type { Bubble as BubbleType, BubbleKind } from "@/lib/connect-game/types";

const KIND_STYLES: Record<BubbleKind, { bg: string; border: string; text: string; glow: string }> =
  {
    kanji: {
      bg: "bg-purple-900/70",
      border: "border-purple-400",
      text: "text-purple-100",
      glow: "rgba(168, 85, 247, 0.4)",
    },
    reading: {
      bg: "bg-blue-900/70",
      border: "border-blue-400",
      text: "text-blue-100",
      glow: "rgba(96, 165, 250, 0.4)",
    },
    meaning: {
      bg: "bg-emerald-900/70",
      border: "border-emerald-400",
      text: "text-emerald-100",
      glow: "rgba(52, 211, 153, 0.4)",
    },
  };

interface BubbleProps {
  bubble: BubbleType;
  fieldWidth: number;
  fieldHeight: number;
  now: number;
}

export function BubbleView({ bubble, fieldWidth, fieldHeight, now }: BubbleProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const isVisible = now >= bubble.spawnedAt;
  const style = KIND_STYLES[bubble.kind];

  useEffect(() => {
    if (isVisible && !bubble.matched && !bubble.expired) {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [isVisible, bubble.matched, bubble.expired, scale, opacity]);

  useEffect(() => {
    if (bubble.matched) {
      scale.value = withTiming(1.3, { duration: 200, easing: Easing.out(Easing.quad) });
      opacity.value = withDelay(100, withTiming(0, { duration: 300 }));
    } else if (bubble.expired) {
      scale.value = withTiming(0.3, { duration: 400 });
      opacity.value = withTiming(0, { duration: 400 });
    }
  }, [bubble.matched, bubble.expired, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!isVisible) return null;

  // Lifetime progress (0 to 1, where 1 = expired)
  const age = Math.max(0, now - bubble.spawnedAt);
  const progress = Math.min(1, age / bubble.lifetime);

  // Position in pixels
  const left = bubble.x * fieldWidth - bubble.width / 2;
  const top = bubble.y * fieldHeight - bubble.height / 2;

  const textSize =
    bubble.kind === "kanji" ? "text-lg" : bubble.kind === "reading" ? "text-base" : "text-sm";

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left,
          top,
          width: bubble.width,
          height: bubble.height,
          shadowColor: style.glow,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: bubble.collected ? 1 : 0.6,
          shadowRadius: bubble.collected ? 12 : 6,
          elevation: 8,
        },
        animatedStyle,
      ]}
    >
      <Animated.View
        className={`flex-1 items-center justify-center rounded-2xl border-2 ${style.bg} ${
          bubble.collected ? "border-yellow-300" : style.border
        }`}
        style={{ overflow: "hidden" }}
      >
        <Text
          className={`font-semibold ${textSize} ${bubble.collected ? "text-yellow-100" : style.text}`}
          numberOfLines={1}
        >
          {bubble.text}
        </Text>

        {/* Lifetime indicator bar */}
        {!bubble.matched && !bubble.expired && (
          <Animated.View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
              backgroundColor:
                progress > 0.7 ? "rgba(239, 68, 68, 0.7)" : "rgba(255, 255, 255, 0.3)",
            }}
          >
            <Animated.View
              style={{
                height: "100%",
                width: `${(1 - progress) * 100}%`,
                backgroundColor:
                  progress > 0.7 ? "rgba(239, 68, 68, 0.9)" : "rgba(255, 255, 255, 0.6)",
              }}
            />
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
