import React, { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import type { Bubble as BubbleType } from "@/lib/connect-game/types";

interface BubbleProps {
  bubble: BubbleType;
  fieldWidth: number;
  fieldHeight: number;
  now: number;
  /** Incremented each time this bubble is part of an invalid swipe */
  invalidTick?: number;
}

export function BubbleView({ bubble, fieldWidth, fieldHeight, now, invalidTick }: BubbleProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const borderFlash = useSharedValue(0);

  const isVisible = now >= bubble.spawnedAt;

  useEffect(() => {
    if (isVisible && !bubble.matched && !bubble.expired) {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [isVisible, bubble.matched, bubble.expired, scale, opacity]);

  /* eslint-disable react-hooks/immutability -- reanimated shared value updates */
  useEffect(() => {
    if (bubble.matched) {
      scale.value = withTiming(1.3, { duration: 200, easing: Easing.out(Easing.quad) });
      opacity.value = withDelay(100, withTiming(0, { duration: 300 }));
    } else if (bubble.expired) {
      scale.value = withTiming(0.3, { duration: 400 });
      opacity.value = withTiming(0, { duration: 400 });
    }
  }, [bubble.matched, bubble.expired, scale, opacity]);
  /* eslint-enable react-hooks/immutability */

  // Shake animation on invalid swipe
  useEffect(() => {
    if (invalidTick && invalidTick > 0) {
      translateX.value = withSequence(
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(-3, { duration: 40 }),
        withTiming(0, { duration: 40 }),
      );
      borderFlash.value = withSequence(
        withTiming(1, { duration: 50 }),
        withTiming(0, { duration: 400 }),
      );
    }
  }, [invalidTick, translateX, borderFlash]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  const innerStyle = useAnimatedStyle(() => {
    const flash = borderFlash.value;
    return {
      borderColor: flash > 0 ? `rgba(239, 68, 68, ${flash})` : undefined,
    };
  });

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
          shadowColor: "rgba(255, 255, 255, 0.15)",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: bubble.collected ? 1 : 0.4,
          shadowRadius: bubble.collected ? 10 : 4,
          elevation: 4,
        },
        animatedStyle,
      ]}
    >
      <Animated.View
        className={`flex-1 items-center justify-center rounded-xl border ${
          bubble.collected ? "border-yellow-400 bg-yellow-950/40" : "border-zinc-600 bg-zinc-900/80"
        }`}
        style={[{ overflow: "hidden" }, innerStyle]}
      >
        <Text
          className={`font-semibold ${textSize} ${bubble.collected ? "text-yellow-100" : "text-zinc-100"}`}
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
                progress > 0.7 ? "rgba(239, 68, 68, 0.5)" : "rgba(255, 255, 255, 0.15)",
            }}
          >
            <Animated.View
              style={{
                height: "100%",
                width: `${(1 - progress) * 100}%`,
                backgroundColor:
                  progress > 0.7 ? "rgba(239, 68, 68, 0.8)" : "rgba(255, 255, 255, 0.4)",
              }}
            />
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
