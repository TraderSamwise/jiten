import React, { useCallback, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { BubbleView } from "./Bubble";
import { SwipeTrail } from "./SwipeTrail";
import { ScoreHUD } from "./ScoreHUD";
import { FloatingLabel } from "@/components/FloatingLabel";
import type { Bubble, BubbleKind, GameState } from "@/lib/connect-game/types";
import { evaluateSwipe } from "@/lib/connect-game/matcher";
import { applyMatch, handleInvalidSwipe } from "@/lib/connect-game/engine";

interface RevealItem {
  key: number;
  text: string;
  x: number;
  y: number;
}

/** Get the text for a bubble kind from an entry */
function getMissingKindText(
  state: GameState,
  entryId: number,
  matchedKinds: Set<BubbleKind>,
): string | null {
  const allKinds: BubbleKind[] = ["kanji", "reading", "meaning"];
  const missing = allKinds.find((k) => !state.enabledKinds.has(k) && !matchedKinds.has(k));
  if (!missing) return null;

  const entry = state.entries.get(entryId);
  if (!entry) return null;

  if (missing === "kanji" && entry.kanji.length > 0) return entry.kanji[0].text;
  if (missing === "reading" && entry.kana.length > 0) return entry.kana[0].text;
  if (missing === "meaning") {
    const gloss = entry.senses[0]?.glosses.find((g) => g.lang === "eng");
    if (gloss) return gloss.text;
  }
  return null;
}

interface PlayFieldProps {
  state: GameState;
  now: number;
  onStateChange: () => void;
}

export function PlayField({ state, now, onStateChange }: PlayFieldProps) {
  const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
  const [trailPoints, setTrailPoints] = useState<{ x: number; y: number }[]>([]);
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  /** Map of bubbleId → tick counter, incremented on each invalid swipe involving that bubble */
  const [invalidTicks, setInvalidTicks] = useState<Record<string, number>>({});
  const [reveals, setReveals] = useState<RevealItem[]>([]);
  const revealKeyRef = useRef(0);
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

        // Reveal the missing kind when playing with only 2 kinds
        if (state.enabledKinds.size === 2) {
          const matchedKinds = new Set(
            match.bubbleIds
              .map((id) => state.bubbles.find((b) => b.id === id)?.kind)
              .filter((k): k is BubbleKind => k != null),
          );
          const text = getMissingKindText(state, match.entryId, matchedKinds);
          if (text) {
            const key = ++revealKeyRef.current;
            setReveals((prev) => [...prev, { key, text, x: lastX, y: lastY }]);
          }
        }
      } else if (isInvalid) {
        handleInvalidSwipe(state);

        // Trigger shake on all collected bubbles
        setInvalidTicks((prev) => {
          const next = { ...prev };
          for (const b of collected) {
            next[b.id] = (next[b.id] ?? 0) + 1;
          }
          return next;
        });
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

  const removeReveal = useCallback((key: number) => {
    setReveals((prev) => prev.filter((r) => r.key !== key));
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
                invalidTick={invalidTicks[bubble.id]}
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

          {/* Reveal missing kind on match (pairs mode) */}
          {reveals.map((r) => (
            <FloatingLabel
              key={r.key}
              text={r.text}
              screenX={r.x}
              screenY={r.y}
              onDone={() => removeReveal(r.key)}
            />
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}
