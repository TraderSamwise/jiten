import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, Pressable, useWindowDimensions, AppState } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { GameSelectScreen } from "@/components/GameSelectScreen";
import { X } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { getEntries } from "@/db/search";
import { PlayField } from "@/components/connect-game/PlayField";
import { GameOverScreen } from "@/components/connect-game/GameOverScreen";
import { createInitialState, spawnWave, tick, cleanupBubbles } from "@/lib/connect-game/engine";
import { useWordFilter, type WordFilterMode } from "@/hooks/useWordFilter";
import type { Phase, GameMode, TimedDuration, GameState } from "@/lib/connect-game/types";
export default function ConnectGameScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const goBack = useSafeGoBack("/lists");
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { dictDb } = useDatabase();

  const [navigating, setNavigating] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<WordFilterMode>("all");
  const gameRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  // Word filter (SRS-based counts + filtering)
  const wordFilter = useWordFilter(listId);

  // ─── Game loop ───

  useEffect(() => {
    if (phase !== "playing") return;

    lastTickRef.current = 0;

    function loop() {
      const state = gameRef.current;
      if (!state || state.phase !== "playing" || state.paused) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const currentTime = Date.now();
      const delta = lastTickRef.current ? currentTime - lastTickRef.current : 16;
      lastTickRef.current = currentTime;

      const result = tick(state, currentTime, delta);

      if (result.gameOver) {
        state.phase = "done";
        setEndedAt(currentTime);
        setPhase("done");
        setGameState({ ...state });
        return;
      }

      if (result.needsNewWave) {
        state.wave++;
        const newBubbles = spawnWave(state, currentTime);
        state.bubbles.push(...newBubbles);
      }

      cleanupBubbles(state, currentTime);

      setNow(currentTime);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  // ─── Pause on app background ───

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const state = gameRef.current;
      if (!state || state.phase !== "playing") return;
      if (nextState === "background" || nextState === "inactive") {
        state.paused = true;
        setNow(Date.now());
      } else if (nextState === "active" && state.paused) {
        const pauseDuration = Date.now() - (lastTickRef.current || Date.now());
        state.startedAt += pauseDuration;
        for (const bubble of state.bubbles) {
          if (!bubble.matched && !bubble.expired) {
            bubble.spawnedAt += pauseDuration;
          }
        }
        state.paused = false;
        lastTickRef.current = 0;
        setNow(Date.now());
      }
    });
    return () => sub.remove();
  }, []);

  // ─── Pause on screen blur (in-app navigation) ───

  /* eslint-disable react-hooks/immutability -- imperative game state via ref */
  useFocusEffect(
    useCallback(() => {
      // Screen focused — resume if was paused by blur
      const state = gameRef.current;
      if (state?.paused && state.phase === "playing") {
        const pauseDuration = Date.now() - (lastTickRef.current || Date.now());
        state.startedAt += pauseDuration;
        for (const bubble of state.bubbles) {
          if (!bubble.matched && !bubble.expired) {
            bubble.spawnedAt += pauseDuration;
          }
        }
        state.paused = false;
        lastTickRef.current = 0;
        setNow(Date.now());
      }

      return () => {
        // Screen blurred — pause
        const s = gameRef.current;
        if (s && s.phase === "playing" && !s.paused) {
          s.paused = true;
          setNow(Date.now());
        }
      };
    }, []),
  );
  /* eslint-enable react-hooks/immutability */

  // ─── Start game ───

  const startGame = useCallback(
    async (mode: GameMode, duration: TimedDuration) => {
      if (!dictDb || !listId) return;

      const entryIds = wordFilter.getFilteredEntryIds(selectedFilter);
      if (entryIds.length < 3) return;

      const entries = await getEntries(dictDb, entryIds);

      // Compute field dimensions (full screen minus header and safe area)
      const fieldWidth = screenWidth;
      const fieldHeight = screenHeight - insets.top - 52 - 60 - insets.bottom; // header + HUD + bottom

      const state = createInitialState(mode, duration, entries, fieldWidth, fieldHeight);

      // Spawn first wave
      const initialBubbles = spawnWave(state, Date.now());
      state.bubbles = initialBubbles;

      gameRef.current = state;
      setGameState(state);
      setPhase("playing");
    },
    [dictDb, listId, screenWidth, screenHeight, insets, wordFilter, selectedFilter],
  );

  const handleStateChange = useCallback(() => {
    setNow(Date.now());
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    gameRef.current = null;
    setGameState(null);
    setPhase("select");
    wordFilter.refresh();
  }, [wordFilter]);

  /* eslint-disable react-hooks/immutability -- imperative game state via ref */
  const togglePause = useCallback(() => {
    const state = gameRef.current;
    if (!state || state.phase !== "playing") return;
    if (state.paused) {
      const pauseDuration = Date.now() - (lastTickRef.current || Date.now());
      state.startedAt += pauseDuration;
      for (const bubble of state.bubbles) {
        if (!bubble.matched && !bubble.expired) {
          bubble.spawnedAt += pauseDuration;
        }
      }
      state.paused = false;
      lastTickRef.current = 0;
    } else {
      state.paused = true;
    }
    setNow(Date.now());
  }, []);
  /* eslint-enable react-hooks/immutability */

  // ─── Render ───

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-border">
          <Pressable
            onPress={() => {
              setNavigating(true);
              setTimeout(() => goBack(), 100);
            }}
            className="p-1 mr-3"
          >
            <X size={24} className="text-foreground" />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground flex-1">Connect Game</Text>
          {phase === "playing" && (
            <Pressable onPress={togglePause} className="p-1">
              <Text className="text-base font-medium text-foreground">
                {gameState?.paused ? "Resume" : "Pause"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Select mode */}
        {phase === "select" && (
          <GameSelectScreen
            title="Connect Game"
            subtitle="Swipe through matching kanji, readings, and meanings"
            wordFilter={wordFilter}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            onStart={() => startGame("timed", 90)}
            minEntries={3}
          />
        )}

        {/* Playing */}
        {phase === "playing" && gameState && (
          <View className="flex-1">
            <PlayField state={gameState} now={now} onStateChange={handleStateChange} />
            {/* Pause overlay */}
            {gameState.paused && (
              <View
                className="absolute inset-0 items-center justify-center bg-black/60"
                style={{ zIndex: 50 }}
              >
                <Text className="text-3xl font-bold text-white mb-4">Paused</Text>
                <Button label="Resume" onPress={togglePause} />
              </View>
            )}
          </View>
        )}

        {/* Game over */}
        {phase === "done" && gameState && (
          <GameOverScreen
            state={gameState}
            endedAt={endedAt}
            onPlayAgain={handlePlayAgain}
            onReturn={() => {
              setNavigating(true);
              setTimeout(() => goBack(), 100);
            }}
          />
        )}
        {navigating && (
          <View className="absolute inset-0 z-50 bg-background items-center justify-center">
            <ActivityIndicator size="large" />
          </View>
        )}
      </View>
    </GestureHandlerRootView>
  );
}
