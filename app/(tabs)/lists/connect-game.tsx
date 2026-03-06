import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, useWindowDimensions, AppState } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
import { useContainerWidth } from "@/lib/use-container-width";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CustomHeaderScreen,
  NavigatingOverlay,
  useWebBackdrop,
} from "@/components/CustomHeaderScreen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAtom } from "jotai";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GameSelectScreen } from "@/components/GameSelectScreen";
import { X } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntries } from "@/db/search";
import { PlayField } from "@/components/connect-game/PlayField";
import { GameOverScreen } from "@/components/connect-game/GameOverScreen";
import { createInitialState, spawnWave, tick, cleanupBubbles } from "@/lib/connect-game/engine";
import { saveGameScore, getHighScore } from "@/lib/game-scores";
import { useSync } from "@/db/sync-provider";
import { confirm } from "@/lib/confirm";
import { useWordFilter, type WordFilterMode } from "@/hooks/useWordFilter";
import {
  connectGameModeAtom,
  connectTimedDurationAtom,
  connectSpeedPresetAtom,
  connectBubbleKindsAtom,
  type ConnectGameMode,
  type ConnectBubbleKinds,
  type SpeedPreset,
} from "@/stores/settings";
import type { Phase, GameState, GameMode, BubbleKind } from "@/lib/connect-game/types";
import type { TimedDuration } from "@/lib/connect-game/types";

export default function ConnectGameScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const goBack = useSafeGoBack("/lists");
  const { triggerSync } = useSync();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const containerWidth = useContainerWidth();
  const { webBgStyle } = useWebBackdrop();
  const { dictDb } = useDatabase();
  const userDb = useUserDb();

  const [navigating, setNavigating] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<WordFilterMode>("all");
  const [highScore, setHighScore] = useState<number | null>(null);
  const [prevBest, setPrevBest] = useState<number | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);
  const lastRenderRef = useRef(0);

  // Persisted settings
  const [gameMode, setGameMode] = useAtom(connectGameModeAtom);
  const [timedDuration, setTimedDuration] = useAtom(connectTimedDurationAtom);
  const [speedPreset, setSpeedPreset] = useAtom(connectSpeedPresetAtom);
  const [bubbleKinds, setBubbleKinds] = useAtom(connectBubbleKindsAtom);

  // Word filter (SRS-based counts + filtering)
  const wordFilter = useWordFilter(listId);

  // ─── Load high score ───

  useEffect(() => {
    if (!userDb || !listId) return;
    getHighScore(userDb, listId, "connect", gameMode, speedPreset)
      .then(setHighScore)
      .catch(() => {});
  }, [userDb, listId, gameMode, speedPreset, phase]);

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
        saveScore(state, currentTime);
        return;
      }

      if (result.needsNewWave) {
        state.wave++;
        const newBubbles = spawnWave(state, currentTime);
        state.bubbles.push(...newBubbles);
      }

      cleanupBubbles(state, currentTime);

      // Throttle React re-renders to ~15fps (game logic still runs at 60fps via ref)
      if (currentTime - lastRenderRef.current >= 66) {
        lastRenderRef.current = currentTime;
        setNow(currentTime);
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  // ─── Save score ───

  const saveScore = useCallback(
    (state: GameState, endTime: number) => {
      if (!userDb || !listId) return;
      const durationMs = endTime - state.startedAt;
      const accuracy =
        state.totalSwipes > 0
          ? Math.round(((state.totalSwipes - state.invalidSwipes) / state.totalSwipes) * 100)
          : 100;
      setPrevBest(highScore);
      saveGameScore(userDb, {
        listId,
        gameType: "connect",
        gameMode: state.mode,
        speedPreset: state.speedPreset,
        score: state.score,
        matchesMade: state.matchesMade,
        triplesMade: state.triplesMade,
        maxCombo: state.maxCombo,
        accuracy,
        durationMs,
      })
        .then(() => triggerSync())
        .catch(() => {});
    },
    [userDb, listId, highScore, triggerSync],
  );

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

  // Bubble kind toggle — enforce at least 2 selected
  const toggleBubbleKind = useCallback(
    (kind: keyof ConnectBubbleKinds) => {
      const enabledCount = Object.values(bubbleKinds).filter(Boolean).length;
      if (bubbleKinds[kind] && enabledCount <= 2) return; // can't disable if only 2 left
      setBubbleKinds({ ...bubbleKinds, [kind]: !bubbleKinds[kind] });
    },
    [bubbleKinds, setBubbleKinds],
  );

  const startGame = useCallback(async () => {
    if (!dictDb || !listId) return;

    const entryIds = wordFilter.getFilteredEntryIds(selectedFilter);
    if (entryIds.length < 3) return;

    const entries = await getEntries(dictDb, entryIds);

    // Compute field dimensions (full screen minus header and safe area)
    const fieldWidth = containerWidth;
    const fieldHeight = screenHeight - insets.top - 52 - 60 - insets.bottom; // header + HUD + bottom

    const mode = gameMode as GameMode;
    const duration = timedDuration as TimedDuration;

    const enabledKinds = new Set<BubbleKind>(
      (Object.entries(bubbleKinds) as [BubbleKind, boolean][]).filter(([, v]) => v).map(([k]) => k),
    );

    const state = createInitialState(
      mode,
      duration,
      entries,
      fieldWidth,
      fieldHeight,
      speedPreset,
      enabledKinds,
    );

    // Spawn first wave
    const initialBubbles = spawnWave(state, Date.now());
    state.bubbles = initialBubbles;

    gameRef.current = state;
    setGameState(state);
    setPhase("playing");
  }, [
    dictDb,
    listId,
    screenHeight,
    insets,
    wordFilter,
    selectedFilter,
    gameMode,
    timedDuration,
    speedPreset,
    bubbleKinds,
  ]);

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

  // ─── Manual exit via X button (zen/survival) ───

  const handleClose = useCallback(async () => {
    const state = gameRef.current;
    if (state && state.phase === "playing" && (state.mode === "zen" || state.mode === "survival")) {
      state.paused = true;
      setNow(Date.now());
      const shouldEnd = await confirm("End game?", `Your score is ${state.score.toLocaleString()}`);
      if (shouldEnd) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        state.phase = "done";
        const endTime = Date.now();
        setEndedAt(endTime);
        setPhase("done");
        setGameState({ ...state });
        saveScore(state, endTime);
        return;
      }
      // Resume
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
      return;
    }
    setNavigating(true);
    setTimeout(() => goBack(), 100);
  }, [goBack, saveScore]);

  // ─── Render ───

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <CustomHeaderScreen>
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-border" style={webBgStyle}>
          <Pressable onPress={handleClose} className="p-1 mr-3">
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
            onStart={startGame}
            minEntries={3}
          >
            <View className="gap-4 mb-6">
              {/* Mode */}
              <View>
                <Text className="text-base font-semibold text-foreground mb-2">Mode</Text>
                <SegmentedControl
                  options={[
                    { value: "timed" as ConnectGameMode, label: "Timed" },
                    { value: "survival" as ConnectGameMode, label: "Survival" },
                    { value: "zen" as ConnectGameMode, label: "Zen" },
                  ]}
                  value={gameMode}
                  onChange={setGameMode}
                  fullWidth
                />
              </View>

              {/* Duration (timed only) */}
              {gameMode === "timed" && (
                <View>
                  <Text className="text-base font-semibold text-foreground mb-2">Duration</Text>
                  <SegmentedControl
                    options={[
                      { value: "60" as string, label: "60s" },
                      { value: "90" as string, label: "90s" },
                      { value: "120" as string, label: "120s" },
                    ]}
                    value={String(timedDuration)}
                    onChange={(v) => setTimedDuration(Number(v) as TimedDuration)}
                    fullWidth
                  />
                </View>
              )}

              {/* Speed */}
              <View>
                <Text className="text-base font-semibold text-foreground mb-2">Speed</Text>
                <SegmentedControl
                  options={[
                    { value: "easy" as SpeedPreset, label: "Easy" },
                    { value: "normal" as SpeedPreset, label: "Normal" },
                    { value: "hard" as SpeedPreset, label: "Hard" },
                  ]}
                  value={speedPreset}
                  onChange={setSpeedPreset}
                  fullWidth
                />
              </View>

              {/* Bubble kinds */}
              <View>
                <Text className="text-base font-semibold text-foreground mb-2">Show</Text>
                <View className="flex-row gap-2">
                  {(
                    [
                      ["kanji", "Kanji"],
                      ["reading", "Kana"],
                      ["meaning", "Definition"],
                    ] as const
                  ).map(([kind, label]) => {
                    const enabled = bubbleKinds[kind];
                    const enabledCount = Object.values(bubbleKinds).filter(Boolean).length;
                    const locked = enabled && enabledCount <= 2;
                    return (
                      <Pressable
                        key={kind}
                        onPress={() => toggleBubbleKind(kind)}
                        className={`flex-1 items-center py-2 rounded-lg border ${
                          enabled ? "border-primary bg-primary/15" : "border-border bg-muted/30"
                        }`}
                        style={locked ? { opacity: 0.6 } : undefined}
                      >
                        <Text
                          className={`text-sm font-medium ${
                            enabled ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* High score */}
              {highScore != null && (
                <Text className="text-base text-muted-foreground text-center">
                  Best: {highScore.toLocaleString()}
                </Text>
              )}
            </View>
          </GameSelectScreen>
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
            previousBest={prevBest}
            onPlayAgain={handlePlayAgain}
            onReturn={() => {
              setNavigating(true);
              setTimeout(() => goBack(), 100);
            }}
          />
        )}
        <NavigatingOverlay visible={navigating} />
      </CustomHeaderScreen>
    </GestureHandlerRootView>
  );
}
