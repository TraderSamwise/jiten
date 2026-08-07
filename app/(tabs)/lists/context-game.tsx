import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CustomHeaderScreen,
  NavigatingOverlay,
  useWebBackdrop,
} from "@/components/CustomHeaderScreen";
import { GameSelectScreen } from "@/components/GameSelectScreen";
import { SentenceView } from "@/components/context-game/SentenceView";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { getUserDrizzle } from "@/db/drizzle";
import { getEntries } from "@/db/search";
import { useSync } from "@/db/sync-provider";
import { useUserDb } from "@/db/user-provider";
import { useContextSentences, toPlayableEntries } from "@/hooks/useContextSentences";
import { useWordFilter } from "@/hooks/useWordFilter";
import { playEntryAudio } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { X, Settings } from "@/lib/icons";
import { useSafeGoBack } from "@/lib/navigation";
import { logPracticeEvent, logSessionSummary } from "@/lib/practice-logger";
import { evaluateTypingInput } from "@/lib/typing-core";
import { romajiToKana } from "@/lib/typing-utils";
import { useAtom } from "jotai";
import {
  contextPlayAudioAtom,
  contextShowEnglishAtom,
  contextWordFilterAtom,
} from "@/stores/settings";

const HEADER_HEIGHT = 52;
/** How long a finished sentence stays on screen before the next one. */
const REVIEW_PAUSE_MS = 1300;

type Phase = "select" | "loading" | "playing" | "done";

export default function ContextGameScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const goBack = useSafeGoBack("/lists");
  const insets = useSafeAreaInsets();
  const { webBgStyle } = useWebBackdrop();
  const { dictDb, audioDb } = useDatabase();
  const userDb = useUserDb();
  const drizzleDb = useMemo(() => (userDb ? getUserDrizzle(userDb) : null), [userDb]);
  const { markDirty } = useSync();
  const { isSignedIn, getToken } = useAuth();

  const [navigating, setNavigating] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [showEnglish, setShowEnglish] = useAtom(contextShowEnglishAtom);
  const [playAudio, setPlayAudio] = useAtom(contextPlayAudioAtom);
  const [selectedFilter, setSelectedFilter] = useAtom(contextWordFilterAtom);
  const wordFilter = useWordFilter(listId);

  const sentences = useContextSentences({ apiBaseUrl: env.API_BASE_URL, getToken });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [typedRomaji, setTypedRomaji] = useState("");
  const [typedKana, setTypedKana] = useState("");
  const [statuses, setStatuses] = useState<ReturnType<typeof evaluateTypingInput>["statuses"]>([]);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState<{ correct: boolean } | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [assistedCount, setAssistedCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [totalPlayable, setTotalPlayable] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const gameRef = useRef<View>(null);
  const isKanaInput = useRef(false);
  const roundStartTime = useRef(0);
  const sessionIdRef = useRef("");
  const sessionDirtyRef = useRef(false);
  const answeredRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const round = sentences.rounds[currentIndex];
  const canPlay = isSignedIn && !!env.API_BASE_URL;

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // Keep the input focused during gameplay (web)
  useEffect(() => {
    if (phase !== "playing") return;
    const node = gameRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const handler = (e: Event) => {
      if ((e.target as HTMLElement)?.tagName !== "INPUT") e.preventDefault();
    };
    node.addEventListener("mousedown", handler);
    return () => node.removeEventListener("mousedown", handler);
  }, [phase]);

  useFocusEffect(
    useCallback(() => {
      if (phase === "playing") setTimeout(() => inputRef.current?.focus(), 100);
    }, [phase]),
  );

  // Keep generation ahead of the player
  const ensureAhead = sentences.ensureAhead;
  useEffect(() => {
    if (phase === "playing") ensureAhead(currentIndex);
  }, [phase, currentIndex, ensureAhead]);

  // Timed from when the sentence appears, not from when the index moved — a wait
  // for the next batch shouldn't count as the player's response time.
  useEffect(() => {
    if (round) roundStartTime.current = Date.now();
  }, [round]);

  // The queue ran dry and nothing more is coming — that's the end of the round
  useEffect(() => {
    if (phase !== "playing" || round || sentences.hasMore || answered) return;
    setEndTime(Date.now());
    setPhase("done");
  }, [phase, round, sentences.hasMore, answered]);

  useEffect(() => {
    if (phase !== "done" || !drizzleDb || !listId || !sessionIdRef.current) return;
    logSessionSummary(drizzleDb, {
      sessionId: sessionIdRef.current,
      listId,
      practiceMode: "context_game",
      startedAt: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
      totalItems: correctCount + assistedCount + incorrectCount,
      correctCount,
    }).catch(() => {});
    // Logged once, when the round ends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function startGame() {
    if (!dictDb || !listId) return;
    setStartError(null);

    const entryIds = wordFilter.getFilteredEntryIds(selectedFilter);
    for (let i = entryIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entryIds[i], entryIds[j]] = [entryIds[j], entryIds[i]];
    }

    const entries = await getEntries(dictDb, entryIds);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const ordered = entryIds.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
    const playable = toPlayableEntries(ordered);

    if (playable.length === 0) {
      setStartError("None of these words are written with kanji, so there's nothing to read.");
      return;
    }

    setTotalPlayable(playable.length);
    setCurrentIndex(0);
    setTypedRomaji("");
    setTypedKana("");
    setStatuses([]);
    setRevealed(false);
    setAnswered(null);
    answeredRef.current = false;
    setCorrectCount(0);
    setAssistedCount(0);
    setIncorrectCount(0);
    setEndTime(0);
    sessionIdRef.current = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    setPhase("loading");

    try {
      await sentences.start(playable);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not generate sentences.");
      setPhase("select");
      return;
    }

    setStartTime(Date.now());
    roundStartTime.current = Date.now();
    setPhase("playing");
    setTimeout(() => inputRef.current?.focus(), 200);
  }

  function finishRound(raw: string, isCorrect: boolean) {
    // Ref, not state: two keystrokes can land in one render pass, and a double
    // fire would double-log the answer and skip the next sentence.
    if (!round || answeredRef.current) return;
    answeredRef.current = true;
    const wasAssisted = revealed;

    if (isCorrect && !wasAssisted) setCorrectCount((c) => c + 1);
    else if (isCorrect) setAssistedCount((c) => c + 1);
    else setIncorrectCount((c) => c + 1);

    if (drizzleDb && listId) {
      if (!sessionDirtyRef.current) {
        sessionDirtyRef.current = true;
        markDirty();
      }
      logPracticeEvent(drizzleDb, {
        entryId: round.entry.id,
        listId,
        practiceMode: "context_game",
        correct: isCorrect,
        assisted: wasAssisted,
        responseMs: Date.now() - roundStartTime.current,
        typedAnswer: romajiToKana(raw),
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

    if (playAudio && audioDb) playEntryAudio(audioDb, round.entry.id);

    setAnswered({ correct: isCorrect });
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      answeredRef.current = false;
      setAnswered(null);
      setRevealed(false);
      setTypedRomaji("");
      setTypedKana("");
      setStatuses([]);
      setCurrentIndex((i) => i + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }, REVIEW_PAUSE_MS);
  }

  function handleInput(raw: string) {
    if (phase !== "playing" || !round || answered) return;

    if (raw.length > 0) {
      const lastCode = raw.charCodeAt(raw.length - 1);
      isKanaInput.current = lastCode >= 0x3040 && lastCode <= 0x30ff;
    }

    setTypedRomaji(raw);
    const target = round.sentence.targetReading;
    const evaluation = evaluateTypingInput({
      raw,
      target,
      acceptedReadings: [target],
      isKanaInput: isKanaInput.current,
    });

    setTypedKana(evaluation.converted);
    setStatuses(evaluation.statuses);

    if (evaluation.isCorrect) {
      finishRound(raw, true);
      return;
    }
    if (evaluation.overrun) finishRound(raw, false);
  }

  const answeredThisRound = answered !== null;
  const total = correctCount + assistedCount + incorrectCount;
  const elapsedSeconds = endTime > 0 ? (endTime - startTime) / 1000 : 0;

  return (
    <CustomHeaderScreen
      ref={gameRef}
      onTouchStart={() => {
        if (phase === "playing") inputRef.current?.focus();
      }}
    >
      <View className="flex-row items-center px-4 py-3 border-b border-border" style={webBgStyle}>
        <Pressable
          onPress={() => {
            setNavigating(true);
            setTimeout(() => goBack(), 100);
          }}
          className="p-1 mr-3"
        >
          <X size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground flex-1">Context Game</Text>
        {phase === "playing" && (
          <Pressable onPress={() => setSettingsOpen((v) => !v)} className="p-1">
            <Settings size={20} className="text-foreground" />
          </Pressable>
        )}
      </View>

      {settingsOpen && (
        <>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 }}
            onPress={() => setSettingsOpen(false)}
          />
          <View
            className="absolute right-4 z-20 rounded-lg border border-border bg-background shadow-lg p-4 gap-4"
            style={{ top: insets.top + HEADER_HEIGHT }}
          >
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Show translation</Text>
              <Switch value={showEnglish} onValueChange={setShowEnglish} />
            </View>
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Audio on complete</Text>
              <Switch value={playAudio} onValueChange={setPlayAudio} />
            </View>
          </View>
        </>
      )}

      {phase === "select" && (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <GameSelectScreen
            title="Context Game"
            subtitle="Read the red word in a sentence and type its reading"
            wordFilter={wordFilter}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            onStart={() => startGame()}
            disabled={!canPlay}
          >
            <View className="gap-3 mb-6">
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-foreground">Show translation</Text>
                <Switch value={showEnglish} onValueChange={setShowEnglish} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-foreground">Audio on complete</Text>
                <Switch value={playAudio} onValueChange={setPlayAudio} />
              </View>
            </View>

            {!canPlay && (
              <Text className="text-sm text-red-400 text-center mb-4">
                Sentences are generated fresh each round, so this game needs you signed in and
                online.
              </Text>
            )}
            {startError && (
              <Text className="text-sm text-red-400 text-center mb-4">{startError}</Text>
            )}
          </GameSelectScreen>
        </ScrollView>
      )}

      {phase === "loading" && (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <ActivityIndicator size="large" />
          <Text className="text-base text-muted-foreground text-center">Writing sentences...</Text>
        </View>
      )}

      {phase === "playing" && (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={insets.top + HEADER_HEIGHT}
        >
          <View className="flex-row items-center justify-between px-4 py-2">
            {total > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Text className="text-sm font-medium text-green-500">{correctCount}</Text>
                {assistedCount > 0 && (
                  <Text className="text-sm font-medium text-yellow-500">+{assistedCount}</Text>
                )}
                <Text className="text-sm text-muted-foreground">/{total}</Text>
              </View>
            ) : (
              <View />
            )}
            <Text className="text-sm text-muted-foreground">
              {currentIndex + 1}/{sentences.hasMore ? totalPlayable : sentences.rounds.length}
            </Text>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {round ? (
              <SentenceView
                sentence={round.sentence}
                statuses={statuses}
                revealed={revealed}
                completed={answeredThisRound}
                correct={answered?.correct ?? false}
                showEnglish={showEnglish}
              />
            ) : (
              <View className="items-center gap-4">
                <ActivityIndicator size="large" />
                <Text className="text-base text-muted-foreground">
                  Writing the next sentence...
                </Text>
              </View>
            )}
          </ScrollView>

          <View
            className="border-t border-border bg-background px-4 py-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <TextInput
              ref={inputRef}
              className="h-12 rounded-lg border border-border bg-background px-4 text-foreground text-lg"
              value={typedRomaji}
              onChangeText={handleInput}
              editable={!answeredThisRound && !!round}
              blurOnSubmit={false}
              onSubmitEditing={() => {
                if (!round || answeredThisRound) return;
                if (revealed) finishRound(typedRomaji, false);
                else setRevealed(true);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              placeholder="Type the reading..."
              placeholderTextColor="#999"
            />
            {typedKana.length > 0 && !answeredThisRound && (
              <Text className="text-sm text-muted-foreground mt-2 text-center">{typedKana}</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      )}

      {phase === "done" && (
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-foreground text-center mb-6">Done!</Text>

          <View className="items-center gap-2 mb-8">
            <Text className="text-lg text-muted-foreground">
              {total} sentences in {Math.round(elapsedSeconds)}s
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text className="text-2xl font-semibold text-green-500">{correctCount}</Text>
              {assistedCount > 0 && (
                <Text className="text-2xl font-semibold text-yellow-500">+{assistedCount}</Text>
              )}
              <Text className="text-2xl font-semibold text-muted-foreground">/{total}</Text>
            </View>
            <View className="flex-row items-center gap-3">
              <Text className="text-sm text-green-500">{correctCount} correct</Text>
              {assistedCount > 0 && (
                <Text className="text-sm text-yellow-500">{assistedCount} assisted</Text>
              )}
              <Text className="text-sm text-red-400">{incorrectCount} wrong</Text>
            </View>
            {/* Set whenever a batch was dropped, so a short round is never unexplained */}
            {sentences.error && (
              <Text className="text-sm text-yellow-500 text-center mt-2">
                Some sentences couldn&apos;t be generated: {sentences.error}
              </Text>
            )}
          </View>

          <View className="gap-3">
            <Button
              label="Play Again"
              onPress={() => {
                sentences.reset();
                setPhase("select");
                setCurrentIndex(0);
                wordFilter.refresh();
              }}
            />
            <Button
              label="Return to List"
              variant="outline"
              onPress={() => {
                setNavigating(true);
                setTimeout(() => goBack(), 100);
              }}
            />
          </View>
        </View>
      )}

      <NavigatingOverlay visible={navigating} />
    </CustomHeaderScreen>
  );
}
