import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, Switch, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CustomHeaderScreen,
  NavigatingOverlay,
  useWebBackdrop,
} from "@/components/CustomHeaderScreen";
import { GameSelectScreen } from "@/components/GameSelectScreen";
import { BlankSentence } from "@/components/fill-blank/BlankSentence";
import { ChoiceGrid } from "@/components/fill-blank/ChoiceGrid";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDatabase } from "@/db/provider";
import { getUserDrizzle } from "@/db/drizzle";
import { getEntries } from "@/db/search";
import { useSync } from "@/db/sync-provider";
import { useUserDb } from "@/db/user-provider";
import { useFillBlankQuestions } from "@/hooks/useFillBlankQuestions";
import { useWordFilter } from "@/hooks/useWordFilter";
import { playEntryAudio } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { MIN_FILL_BLANK_WORDS, toPlayableFillBlankEntries } from "@/lib/fill-blank-candidates";
import { X, Settings } from "@/lib/icons";
import { useSafeGoBack } from "@/lib/navigation";
import { logPracticeEvent, logSessionSummary } from "@/lib/practice-logger";
import { useAtom } from "jotai";
import {
  fillBlankPlayAudioAtom,
  fillBlankShowEnglishAtom,
  fillBlankShowFuriganaAtom,
  fillBlankWordFilterAtom,
} from "@/stores/settings";

const HEADER_HEIGHT = 52;
/** How long an answered question stays on screen before the next one. */
const REVIEW_PAUSE_MS = 1800;

type Phase = "select" | "loading" | "playing" | "done";

export default function FillBlankScreen() {
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

  const [showFurigana, setShowFurigana] = useAtom(fillBlankShowFuriganaAtom);
  const [showEnglish, setShowEnglish] = useAtom(fillBlankShowEnglishAtom);
  const [playAudio, setPlayAudio] = useAtom(fillBlankPlayAudioAtom);
  const [selectedFilter, setSelectedFilter] = useAtom(fillBlankWordFilterAtom);
  const wordFilter = useWordFilter(listId);

  const questions = useFillBlankQuestions({ apiBaseUrl: env.API_BASE_URL, getToken });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [totalPlayable, setTotalPlayable] = useState(0);

  const roundStartTime = useRef(0);
  const sessionIdRef = useRef("");
  const sessionDirtyRef = useRef(false);
  const answeredRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const round = questions.rounds[currentIndex];
  const canPlay = isSignedIn && !!env.API_BASE_URL;

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // Keep generation ahead of the player
  const ensureAhead = questions.ensureAhead;
  useEffect(() => {
    if (phase === "playing") ensureAhead(currentIndex);
  }, [phase, currentIndex, ensureAhead]);

  // Timed from when the question appears, not from when the index moved — a wait
  // for the next batch shouldn't count as the player's response time.
  useEffect(() => {
    if (round) roundStartTime.current = Date.now();
  }, [round]);

  // The queue ran dry and nothing more is coming — that's the end of the round
  useEffect(() => {
    if (phase !== "playing" || round || questions.hasMore || chosenIndex !== null) return;
    setEndTime(Date.now());
    setPhase("done");
  }, [phase, round, questions.hasMore, chosenIndex]);

  useEffect(() => {
    if (phase !== "done" || !drizzleDb || !listId || !sessionIdRef.current) return;
    logSessionSummary(drizzleDb, {
      sessionId: sessionIdRef.current,
      listId,
      practiceMode: "fill_blank_game",
      startedAt: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
      totalItems: correctCount + incorrectCount,
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
    // Entry counts over-promise: words spelled the same collapse to one choice,
    // so the select screen's gate can pass where this one doesn't.
    const playable = toPlayableFillBlankEntries(ordered);
    if (playable.length < MIN_FILL_BLANK_WORDS) {
      setStartError(
        `This needs ${MIN_FILL_BLANK_WORDS} differently spelled words, so every question has four choices.`,
      );
      return;
    }

    setTotalPlayable(playable.length);
    setCurrentIndex(0);
    setChosenIndex(null);
    answeredRef.current = false;
    setCorrectCount(0);
    setIncorrectCount(0);
    setEndTime(0);
    sessionIdRef.current = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    setPhase("loading");

    let produced = 0;
    try {
      produced = await questions.start(playable);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not generate questions.");
      setPhase("select");
      return;
    }

    // A batch that answered but produced nothing playable would otherwise drop
    // the player straight onto a "Done! 0" screen with no explanation.
    if (produced === 0) {
      setStartError("No questions could be built from these words. Try again or pick another set.");
      setPhase("select");
      return;
    }

    setStartTime(Date.now());
    roundStartTime.current = Date.now();
    setPhase("playing");
  }

  function choose(index: number) {
    // Ref, not state: two taps can land in one render pass, and a double fire
    // would double-log the answer and skip a question.
    if (!round || answeredRef.current) return;
    answeredRef.current = true;

    const isCorrect = index === round.answerIndex;
    if (isCorrect) setCorrectCount((c) => c + 1);
    else setIncorrectCount((c) => c + 1);
    setChosenIndex(index);

    if (drizzleDb && listId) {
      if (!sessionDirtyRef.current) {
        sessionDirtyRef.current = true;
        markDirty();
      }
      logPracticeEvent(drizzleDb, {
        entryId: round.entry.id,
        listId,
        practiceMode: "fill_blank_game",
        correct: isCorrect,
        assisted: false,
        responseMs: Date.now() - roundStartTime.current,
        typedAnswer: round.options[index].surface,
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

    if (playAudio && audioDb) playEntryAudio(audioDb, round.entry.id);

    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      answeredRef.current = false;
      setChosenIndex(null);
      setCurrentIndex((i) => i + 1);
    }, REVIEW_PAUSE_MS);
  }

  const total = correctCount + incorrectCount;
  const elapsedSeconds = endTime > 0 ? (endTime - startTime) / 1000 : 0;

  return (
    <CustomHeaderScreen>
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
        <Text className="text-lg font-semibold text-foreground flex-1">Fill in the Blank</Text>
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
              <Text className="text-sm text-foreground">Show readings</Text>
              <Switch value={showFurigana} onValueChange={setShowFurigana} />
            </View>
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Translation when answered</Text>
              <Switch value={showEnglish} onValueChange={setShowEnglish} />
            </View>
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Audio on answer</Text>
              <Switch value={playAudio} onValueChange={setPlayAudio} />
            </View>
          </View>
        </>
      )}

      {phase === "select" && (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <GameSelectScreen
            title="Fill in the Blank"
            subtitle="Choose the word that completes the sentence"
            wordFilter={wordFilter}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            onStart={() => startGame()}
            disabled={!canPlay}
            minEntries={MIN_FILL_BLANK_WORDS}
          >
            <View className="gap-3 mb-6">
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-foreground">Show readings</Text>
                <Switch value={showFurigana} onValueChange={setShowFurigana} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-foreground">Translation when answered</Text>
                <Switch value={showEnglish} onValueChange={setShowEnglish} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-foreground">Audio on answer</Text>
                <Switch value={playAudio} onValueChange={setPlayAudio} />
              </View>
            </View>

            {!canPlay && (
              <Text className="text-sm text-red-400 text-center mb-4">
                Questions are written fresh each round, so this game needs you signed in and online.
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
          <Text className="text-base text-muted-foreground text-center">Writing questions...</Text>
        </View>
      )}

      {phase === "playing" && (
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-2">
            {total > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Text className="text-sm font-medium text-green-500">{correctCount}</Text>
                <Text className="text-sm text-muted-foreground">/{total}</Text>
              </View>
            ) : (
              <View />
            )}
            <Text className="text-sm text-muted-foreground">
              {currentIndex + 1}/{questions.hasMore ? totalPlayable : questions.rounds.length}
            </Text>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 32 }}
          >
            {round ? (
              <>
                <BlankSentence
                  question={round.question}
                  answered={chosenIndex !== null}
                  showEnglish={showEnglish}
                />
                <ChoiceGrid
                  options={round.options}
                  answerIndex={round.answerIndex}
                  chosenIndex={chosenIndex}
                  showFurigana={showFurigana}
                  onChoose={choose}
                />
              </>
            ) : (
              <View className="items-center gap-4">
                <ActivityIndicator size="large" />
                <Text className="text-base text-muted-foreground">
                  Writing the next question...
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {phase === "done" && (
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-foreground text-center mb-6">Done!</Text>

          <View className="items-center gap-2 mb-8">
            <Text className="text-lg text-muted-foreground">
              {total} questions in {Math.round(elapsedSeconds)}s
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text className="text-2xl font-semibold text-green-500">{correctCount}</Text>
              <Text className="text-2xl font-semibold text-muted-foreground">/{total}</Text>
            </View>
            <View className="flex-row items-center gap-3">
              <Text className="text-sm text-green-500">{correctCount} correct</Text>
              <Text className="text-sm text-red-400">{incorrectCount} wrong</Text>
            </View>
            {/* Set whenever a batch was dropped, so a short round is never unexplained */}
            {questions.quotaExhausted ? (
              <Text className="text-sm text-yellow-500 text-center mt-2">
                That&apos;s the daily AI limit — the round ended here. It resets tomorrow.
              </Text>
            ) : (
              questions.error && (
                <Text className="text-sm text-yellow-500 text-center mt-2">
                  Some questions couldn&apos;t be written: {questions.error}
                </Text>
              )
            )}
          </View>

          <View className="gap-3">
            <Button
              label="Play Again"
              onPress={() => {
                questions.reset();
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
