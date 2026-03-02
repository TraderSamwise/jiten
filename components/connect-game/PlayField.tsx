import React, { useCallback, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { BubbleView } from "./Bubble";
import { SwipeTrail } from "./SwipeTrail";
import { MatchFlash } from "./MatchFlash";
import { ScoreHUD } from "./ScoreHUD";
import type { Bubble, GameState, MatchResult } from "@/lib/connect-game/types";
import { evaluateSwipe } from "@/lib/connect-game/matcher";
import { applyMatch, handleInvalidSwipe } from "@/lib/connect-game/engine";

interface PlayFieldProps {
  state: GameState;
  now: number;
  onStateChange: () => void;
}

interface FlashItem {
  key: number;
  match: MatchResult;
  x: number;
  y: number;
}

export function PlayField({ state, now, onStateChange }: PlayFieldProps) {
  const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
  const [trailPoints, setTrailPoints] = useState<{ x: number; y: number }[]>([]);
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const [flashes, setFlashes] = useState<FlashItem[]>([]);
  const flashKeyRef = useRef(0);
  const collectedRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFieldSize({ width, height });
  }, []);

  const hitTest = useCallback(
    (x: number, y: number): Bubble | null => {
      for (const bubble of state.bubbles) {
        if (bubble.matched || bubble.expired || now < bubble.spawnedAt) continue;
        const bx = bubble.x * fieldSize.width;
        const by = bubble.y * fieldSize.height;
        const hw = bubble.width / 2 + 8; // extra hitbox padding
        const hh = bubble.height / 2 + 8;
        if (x >= bx - hw && x <= bx + hw && y >= by - hh && y <= by + hh) {
          return bubble;
        }
      }
      return null;
    },
    [state.bubbles, fieldSize, now],
  );

  const handlePanUpdate = useCallback(
    (x: number, y: number) => {
      if (debounceRef.current) return;

      setTrailPoints((prev) => {
        const next = [...prev, { x, y }];
        return next.length > 50 ? next.slice(-50) : next;
      });

      const hit = hitTest(x, y);
      if (hit && !collectedRef.current.has(hit.id)) {
        collectedRef.current.add(hit.id);
        hit.collected = true;
        onStateChange();
      }
    },
    [hitTest, onStateChange],
  );

  const handlePanEnd = useCallback(
    (lastX: number, lastY: number) => {
      const collected = state.bubbles.filter((b) => collectedRef.current.has(b.id));
      state.totalSwipes++;

      const { match, isInvalid } = evaluateSwipe(collected, state.combo, Date.now());

      if (match) {
        applyMatch(state, match);

        // Show flash at swipe end position
        const key = ++flashKeyRef.current;
        setFlashes((prev) => [...prev, { key, match, x: lastX, y: lastY }]);
      } else if (isInvalid) {
        handleInvalidSwipe(state);
      }

      // Uncollect any remaining collected bubbles
      for (const bubble of state.bubbles) {
        if (bubble.collected && !bubble.matched) {
          bubble.collected = false;
        }
      }

      collectedRef.current.clear();
      setTrailPoints([]);
      setIsSwipeActive(false);
      onStateChange();

      // Short debounce after evaluation
      debounceRef.current = true;
      setTimeout(() => {
        debounceRef.current = false;
      }, 150);
    },
    [state, onStateChange],
  );

  const handlePanStart = useCallback(() => {
    collectedRef.current.clear();
    setTrailPoints([]);
    setIsSwipeActive(true);
  }, []);

  const panGesture = Gesture.Pan()
    .minDistance(5)
    .onStart((e) => {
      runOnJS(handlePanStart)();
      runOnJS(handlePanUpdate)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(handlePanUpdate)(e.x, e.y);
    })
    .onEnd((e) => {
      runOnJS(handlePanEnd)(e.x, e.y);
    })
    .onFinalize(() => {
      runOnJS(setIsSwipeActive)(false);
    });

  const removeFlash = useCallback((key: number) => {
    setFlashes((prev) => prev.filter((f) => f.key !== key));
  }, []);

  return (
    <View className="flex-1">
      <ScoreHUD state={state} />

      <GestureDetector gesture={panGesture}>
        <View className="flex-1 bg-background" onLayout={onLayout}>
          {fieldSize.width > 0 &&
            state.bubbles.map((bubble) => (
              <BubbleView
                key={bubble.id}
                bubble={bubble}
                fieldWidth={fieldSize.width}
                fieldHeight={fieldSize.height}
                now={now}
              />
            ))}

          {/* Swipe trail */}
          {fieldSize.width > 0 && (
            <SwipeTrail
              points={trailPoints}
              width={fieldSize.width}
              height={fieldSize.height}
              isActive={isSwipeActive}
            />
          )}

          {/* Match flashes */}
          {flashes.map((f) => (
            <MatchFlash
              key={f.key}
              match={f.match}
              x={f.x}
              y={f.y}
              onDone={() => removeFlash(f.key)}
            />
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}
