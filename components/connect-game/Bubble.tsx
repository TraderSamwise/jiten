import React, { useEffect, useState } from "react";
import { View } from "react-native";
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

// ─── Confetti burst ───

const PARTICLE_COUNT = 10;
const CONFETTI_COLORS = [
  "#4ade80", // green-400
  "#22c55e", // green-500
  "#86efac", // green-300
  "#fbbf24", // amber-400
  "#fde68a", // amber-200
  "#ffffff",
];

interface ParticleData {
  angle: number;
  distance: number;
  width: number;
  height: number;
  color: string;
  delay: number;
  spinDir: number; // +1 or -1
  initialRotation: number;
}

function generateParticles(): ParticleData[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: Math.random() * Math.PI * 2,
    distance: 35 + Math.random() * 45,
    width: 4 + Math.random() * 5,
    height: 7 + Math.random() * 6,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    delay: Math.random() * 80,
    spinDir: Math.random() > 0.5 ? 1 : -1,
    initialRotation: Math.random() * 360,
  }));
}

function useParticleData(): ParticleData[] {
  const [data] = useState(generateParticles);
  return data;
}

function ConfettiParticle({ data, triggered }: { data: ParticleData; triggered: boolean }) {
  const progress = useSharedValue(0);
  const particleOpacity = useSharedValue(0);

  useEffect(() => {
    if (triggered) {
      particleOpacity.value = withDelay(
        data.delay,
        withSequence(
          withTiming(1, { duration: 60 }),
          withDelay(250, withTiming(0, { duration: 350 })),
        ),
      );
      progress.value = withDelay(
        data.delay,
        withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [triggered, progress, particleOpacity, data.delay]);

  const style = useAnimatedStyle(() => {
    const dx = Math.cos(data.angle) * data.distance * progress.value;
    const dy = Math.sin(data.angle) * data.distance * progress.value;
    const rotate = data.initialRotation + progress.value * 360 * data.spinDir;
    return {
      transform: [{ translateX: dx }, { translateY: dy }, { rotate: `${rotate}deg` }],
      opacity: particleOpacity.value,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: data.width,
          height: data.height,
          borderRadius: 1.5,
          backgroundColor: data.color,
          left: "50%",
          top: "50%",
          marginLeft: -data.width / 2,
          marginTop: -data.height / 2,
        },
        style,
      ]}
      pointerEvents="none"
    />
  );
}

// ─── Bubble ───

interface BubbleProps {
  bubble: BubbleType;
  fieldWidth: number;
  fieldHeight: number;
  now: number;
  /** Incremented each time this bubble is part of an invalid swipe */
  invalidTick?: number;
}

export const BubbleView = React.memo(function BubbleView({
  bubble,
  fieldWidth,
  fieldHeight,
  now,
  invalidTick,
}: BubbleProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const borderFlash = useSharedValue(0);

  const isVisible = now >= bubble.spawnedAt;
  const particles = useParticleData();

  useEffect(() => {
    if (isVisible && !bubble.matched && !bubble.expired) {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [isVisible, bubble.matched, bubble.expired, scale, opacity]);

  /* eslint-disable react-hooks/immutability -- reanimated shared value updates */
  useEffect(() => {
    if (bubble.matched) {
      // Punch up, hold bright green, then expand and dissolve
      scale.value = withSequence(
        withTiming(1.5, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1.4, { duration: 350 }),
        withTiming(2, { duration: 300, easing: Easing.out(Easing.quad) }),
      );
      opacity.value = withDelay(470, withTiming(0, { duration: 300 }));
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
        },
        animatedStyle,
      ]}
    >
      <Animated.View
        className={`flex-1 items-center justify-center rounded-xl border ${
          bubble.matched
            ? "border-green-400 bg-green-600"
            : bubble.collected
              ? "border-yellow-400 bg-yellow-950/40"
              : "border-zinc-600 bg-zinc-900/80"
        }`}
        style={[{ overflow: "hidden" }, innerStyle]}
      >
        <Text
          className={`font-bold ${textSize} ${
            bubble.matched ? "text-white" : bubble.collected ? "text-yellow-100" : "text-zinc-100"
          }`}
          numberOfLines={1}
        >
          {bubble.text}
        </Text>

        {/* Lifetime indicator bar */}
        {!bubble.matched && !bubble.expired && (
          <View
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
            <View
              style={{
                height: "100%",
                width: `${(1 - progress) * 100}%`,
                backgroundColor:
                  progress > 0.7 ? "rgba(239, 68, 68, 0.8)" : "rgba(255, 255, 255, 0.4)",
              }}
            />
          </View>
        )}
      </Animated.View>

      {/* Confetti burst on match */}
      {bubble.matched &&
        particles.map((p, i) => <ConfettiParticle key={i} data={p} triggered={bubble.matched} />)}
    </Animated.View>
  );
});
