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
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Gesture,
  GestureDetector,
  ScrollView as GestureScrollView,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

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
import { X, Settings, ChevronLeft, ChevronRight } from "@/lib/icons";
import { useSafeGoBack } from "@/lib/navigation";
import { useContainerWidth } from "@/lib/use-container-width";
import { logPracticeEvent, logSessionSummary } from "@/lib/practice-logger";
import { evaluateTypingInput } from "@/lib/typing-core";
import type { CharStatus } from "@/lib/typing-utils";
import { useAtom } from "jotai";
import {
  contextPlayAudioAtom,
  contextShowEnglishAtom,
  contextWordFilterAtom,
} from "@/stores/settings";

const HEADER_HEIGHT = 52;
/** How long a finished sentence stays on screen before the next one. */
const REVIEW_PAUSE_MS = 1300;
/**
 * Grace period before a too-long answer is marked wrong. Typing the last kana
 * wrong used to be graded the instant it landed, with no chance to backspace —
 * this holds the verdict open long enough to fix a slip.
 */
const WRONG_GRACE_MS = 1500;

// Carousel geometry, matching the study screen's flashcards: neighbours peek in
// at the edges so it reads as a deck you move through rather than a screen that
// swaps contents.
const CARD_PEEK = 24;
const CARD_GAP = 16;
const SLIDE_DURATION = 250;
const SLIDE_CONFIG = { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) };
/** Fixed, so a short sentence and a long one don't resize the deck between rounds. */
const DECK_HEIGHT = 280;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY = 500;
/** Sentences rendered either side of the current one. */
const WINDOW_RADIUS = 1;

type Phase = "select" | "loading" | "playing" | "done";

/** Kept per round so a sentence swiped back to still shows how it was answered. */
interface RoundAnswer {
  correct: boolean;
  assisted: boolean;
  typedRomaji: string;
  typedKana: string;
  statuses: CharStatus[];
}

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
  /** The furthest sentence reached, so swiping back can find its way forward again. */
  const [furthestIndex, setFurthestIndex] = useState(0);
  const [typedRomaji, setTypedRomaji] = useState("");
  const [typedKana, setTypedKana] = useState("");
  const [statuses, setStatuses] = useState<CharStatus[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<Record<number, RoundAnswer>>({});
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [totalPlayable, setTotalPlayable] = useState(0);

  const router = useRouter();
  const containerWidth = useContainerWidth();
  const cardWidth = containerWidth - 32 - 2 * CARD_PEEK - 2 * CARD_GAP;
  const slideDistance = cardWidth + CARD_GAP;
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);

  const inputRef = useRef<TextInput>(null);
  const gameRef = useRef<View>(null);
  const isKanaInput = useRef(false);
  const roundStartTime = useRef(0);
  const sessionIdRef = useRef("");
  const sessionDirtyRef = useRef(false);
  const answeredRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read by the grace timer, so it commits whatever is on screen when it fires. */
  const latestRaw = useRef("");
  /** Set only by opening a word's entry, so only that trip resumes the advance. */
  const resumeAdvance = useRef(false);
  /** Mirrors `revealed` for the grace timer, whose closure predates the reveal. */
  const revealedRef = useRef(false);
  revealedRef.current = revealed;

  const round = sentences.rounds[currentIndex];
  const canPlay = isSignedIn && !!env.API_BASE_URL;
  const currentAnswer = answers[currentIndex] ?? null;
  const answeredThisRound = currentAnswer !== null;

  // Derived rather than counted up as answers land: revisiting a sentence can no
  // longer double-count it, and the totals always match the answers themselves.
  const { correctCount, assistedCount, incorrectCount } = useMemo(() => {
    let correct = 0;
    let assisted = 0;
    let incorrect = 0;
    for (const answer of Object.values(answers)) {
      if (!answer.correct) incorrect++;
      else if (answer.assisted) assisted++;
      else correct++;
    }
    return { correctCount: correct, assistedCount: assisted, incorrectCount: incorrect };
  }, [answers]);

  const clearGrace = useCallback(() => {
    if (graceTimer.current) {
      clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
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
      if (phase !== "playing") return;
      setTimeout(() => inputRef.current?.focus(), 100);
      // Opening a word's entry cancels the advance so the same sentence is still
      // here on the way back; this restarts it. Gated on a one-shot ref because
      // this effect also re-runs on every index change — without it, swiping back
      // to an answered sentence would immediately drag the player forward again.
      if (!resumeAdvance.current) return;
      resumeAdvance.current = false;
      if (answeredThisRound && !advanceTimer.current) scheduleAdvance(currentIndex);
      // scheduleAdvance is redefined every render; the deps that matter are here
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, answeredThisRound, currentIndex]),
  );

  // Keep generation ahead of the player
  const ensureAhead = sentences.ensureAhead;
  useEffect(() => {
    if (phase === "playing") ensureAhead(currentIndex);
  }, [phase, currentIndex, ensureAhead]);

  // Timed from when the sentence appears, not from when the index moved — a wait
  // for the next batch shouldn't count as the player's response time. Skipped for
  // an answered sentence, which is being reviewed rather than played.
  useEffect(() => {
    if (round && !answeredThisRound) roundStartTime.current = Date.now();
  }, [round, answeredThisRound]);

  // The queue ran dry and nothing more is coming — that's the end of the round
  useEffect(() => {
    if (phase !== "playing" || round || sentences.hasMore || answeredThisRound) return;
    setEndTime(Date.now());
    setPhase("done");
  }, [phase, round, sentences.hasMore, answeredThisRound]);

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
    setFurthestIndex(0);
    translateX.value = 0;
    setTypedRomaji("");
    setTypedKana("");
    setStatuses([]);
    setRevealed(false);
    setAnswers({});
    answeredRef.current = false;
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

  function cancelAdvance() {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  function scheduleAdvance(fromIndex: number) {
    cancelAdvance();
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      goToIndex(fromIndex + 1);
    }, REVIEW_PAUSE_MS);
  }

  /** State half of a move. The gesture animates the deck itself, so it calls this. */
  function applyIndex(index: number) {
    clearGrace();
    cancelAdvance();
    // Any deliberate move cancels a pending resume, so a push that never happened
    // can't strand the flag and yank the player off a later sentence.
    resumeAdvance.current = false;
    // A sentence not reached before starts with a clean input; going back to one
    // already in progress keeps whatever was typed into it.
    if (index > furthestIndex) {
      setFurthestIndex(index);
      setTypedRomaji("");
      setTypedKana("");
      setStatuses([]);
      setRevealed(false);
      latestRaw.current = "";
    }
    answeredRef.current = answers[index] != null;
    setCurrentIndex(index);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function goToIndex(index: number) {
    if (index < 0) return;
    applyIndex(index);
    translateX.value = withTiming(-(index * slideDistance), SLIDE_CONFIG);
  }

  const canGoBack = currentIndex > 0;
  // An answered sentence can always be moved past, even when it's the newest one.
  const canGoForward = currentIndex < furthestIndex || answeredThisRound;

  function finishRound(raw: string, isCorrect: boolean) {
    // Ref, not state: two keystrokes can land in one render pass, and a double
    // fire would double-log the answer and skip the next sentence.
    if (!round || answeredRef.current) return;
    answeredRef.current = true;
    clearGrace();

    const answerIndex = currentIndex;
    // Via the ref: the grace timer's closure predates an Enter press that revealed
    // the answer, and would otherwise log an assisted miss as a plain one.
    const wasAssisted = revealedRef.current;
    const target = round.sentence.targetReading;
    // Re-evaluated rather than read from state: the keystroke that got here set
    // that state in the same pass, so it hasn't landed yet.
    const evaluation = evaluateTypingInput({
      raw,
      target,
      acceptedReadings: [target],
      isKanaInput: isKanaInput.current,
    });

    setAnswers((prev) => ({
      ...prev,
      [answerIndex]: {
        correct: isCorrect,
        assisted: wasAssisted,
        typedRomaji: raw,
        typedKana: evaluation.converted,
        statuses: evaluation.statuses,
      },
    }));

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
        typedAnswer: evaluation.converted,
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

    if (playAudio && audioDb) playEntryAudio(audioDb, round.entry.id);

    scheduleAdvance(answerIndex);
  }

  function handleInput(raw: string) {
    if (phase !== "playing" || !round || answeredThisRound) return;

    if (raw.length > 0) {
      const lastCode = raw.charCodeAt(raw.length - 1);
      isKanaInput.current = lastCode >= 0x3040 && lastCode <= 0x30ff;
    }

    // Predictive keyboards re-fire onChangeText with identical text; without this
    // the grace window below would restart forever and never grade the answer.
    const rawChanged = raw !== latestRaw.current;
    setTypedRomaji(raw);
    latestRaw.current = raw;
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
    if (evaluation.overrun) {
      // Held open rather than graded on the spot: a mistyped last kana can be
      // backspaced away inside this window, which cancels the verdict below.
      // Restarted on each real keystroke, so a player still correcting at the
      // deadline isn't graded on a half-typed string.
      if (rawChanged || !graceTimer.current) {
        clearGrace();
        graceTimer.current = setTimeout(() => {
          graceTimer.current = null;
          finishRound(latestRaw.current, false);
        }, WRONG_GRACE_MS);
      }
      return;
    }
    // Back under length — whatever was pending is no longer wrong.
    clearGrace();
  }

  // Read by the swipe gesture, which is rebuilt only when the values it closes
  // over change, but commits through the current render's state setters.
  const commitIndex = useRef((index: number) => applyIndex(index));
  commitIndex.current = applyIndex;

  function commitFromGesture(index: number) {
    commitIndex.current(index);
  }

  /** Stops anything that would move the deck while the player is holding it. */
  const pauseTimersRef = useRef(() => {});
  pauseTimersRef.current = () => {
    clearGrace();
    cancelAdvance();
  };

  function pauseTimers() {
    pauseTimersRef.current();
  }

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-15, 15])
        .failOffsetY([-15, 15])
        .onStart(() => {
          // Touching the deck takes control of it: kill the timers that would
          // otherwise move it, and stop any slide already running so the drag
          // isn't fighting an animation for the same value.
          runOnJS(pauseTimers)();
          cancelAnimation(translateX);
          gestureStartX.value = translateX.value;
        })
        .onUpdate((e) => {
          // Past either end the deck still follows, but heavily damped, so the
          // edge is felt rather than hit.
          const resisted =
            (e.translationX > 0 && !canGoBack) || (e.translationX < 0 && !canGoForward);
          translateX.value = gestureStartX.value + e.translationX * (resisted ? 0.3 : 1);
        })
        .onEnd((e) => {
          const back =
            canGoBack && (e.translationX > SWIPE_THRESHOLD || e.velocityX > SWIPE_VELOCITY);
          const forward =
            canGoForward && (e.translationX < -SWIPE_THRESHOLD || e.velocityX < -SWIPE_VELOCITY);

          // Targets are absolute slots, never `gestureStartX ± slideDistance`:
          // grabbing the deck mid-slide would otherwise anchor to an interpolated
          // value and leave it permanently off-grid. The index commits here rather
          // than in the animation callback, which a new grab would cancel — so the
          // committed index and the slot being animated to can never disagree.
          const next = back ? currentIndex - 1 : forward ? currentIndex + 1 : currentIndex;
          translateX.value = withTiming(-(next * slideDistance), SLIDE_CONFIG);
          if (next !== currentIndex) runOnJS(commitFromGesture)(next);
        }),
    [canGoBack, canGoForward, currentIndex, slideDistance, translateX, gestureStartX],
  );

  // Keep the deck aligned when the viewport resizes and slideDistance shifts
  useEffect(() => {
    translateX.value = -(currentIndex * slideDistance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideDistance]);

  const deckStyle = useAnimatedStyle(() => ({
    flexDirection: "row" as const,
    transform: [{ translateX: translateX.value }],
  }));

  // The current slot may sit one past the last generated sentence — that's the
  // "writing the next one" card, so the deck has to extend to cover it.
  // One slot past the last generated sentence while more are coming, so dragging
  // toward it reveals the "writing the next one" card instead of blank space.
  const lastIndex =
    Math.max(currentIndex, sentences.rounds.length - 1) + (sentences.hasMore ? 1 : 0);
  const deckWidth = (lastIndex + 1) * slideDistance;
  const windowIndices: number[] = [];
  for (
    let i = Math.max(0, currentIndex - WINDOW_RADIUS);
    i <= Math.min(lastIndex, currentIndex + WINDOW_RADIUS);
    i++
  ) {
    windowIndices.push(i);
  }

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
        <Text className="text-lg font-semibold text-foreground flex-1">Read in Context</Text>
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
            title="Read in Context"
            subtitle="Type the reading of the highlighted word"
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
            {/* Chevrons as well as the swipe: on web there is nothing to swipe with */}
            <View className="flex-row items-center gap-1">
              <Pressable
                onPress={() => goToIndex(currentIndex - 1)}
                disabled={!canGoBack}
                hitSlop={8}
                className="p-1"
                style={{ opacity: canGoBack ? 1 : 0.25 }}
              >
                <ChevronLeft size={18} className="text-foreground" />
              </Pressable>
              <Text className="text-sm text-muted-foreground">
                {currentIndex + 1}/{sentences.hasMore ? totalPlayable : sentences.rounds.length}
              </Text>
              <Pressable
                onPress={() => goToIndex(currentIndex + 1)}
                disabled={!canGoForward}
                hitSlop={8}
                className="p-1"
                style={{ opacity: canGoForward ? 1 : 0.25 }}
              >
                <ChevronRight size={18} className="text-foreground" />
              </Pressable>
            </View>
          </View>

          <View className="flex-1 justify-center">
            <GestureDetector gesture={swipeGesture}>
              <View style={{ overflow: "hidden", paddingHorizontal: 16, height: DECK_HEIGHT }}>
                <Animated.View
                  style={[
                    deckStyle,
                    { marginLeft: CARD_PEEK + CARD_GAP, width: deckWidth, flex: 1 },
                  ]}
                >
                  {windowIndices.map((i) => {
                    const item = sentences.rounds[i];
                    const answer = answers[i] ?? null;
                    const isCurrent = i === currentIndex;
                    return (
                      <View
                        key={i}
                        style={{
                          position: "absolute",
                          left: i * slideDistance,
                          width: cardWidth,
                          top: 0,
                          bottom: 0,
                          // Neighbours recede, so it's obvious which one is live
                          opacity: isCurrent ? 1 : 0.35,
                        }}
                      >
                        {/* Scrolls inside the card: the deck height is fixed so the
                            layout never jumps, but a long sentence must not be
                            cropped by the deck's overflow: hidden. The pan fails on
                            vertical movement, so this still gets the gesture. */}
                        <GestureScrollView
                          className="flex-1 rounded-2xl border border-border bg-card"
                          contentContainerStyle={{
                            flexGrow: 1,
                            justifyContent: "center",
                            paddingHorizontal: 16,
                            paddingVertical: 24,
                          }}
                          keyboardShouldPersistTaps="handled"
                          showsVerticalScrollIndicator={false}
                        >
                          {item ? (
                            <SentenceView
                              sentence={item.sentence}
                              statuses={answer?.statuses ?? (isCurrent ? statuses : [])}
                              revealed={answer !== null || (isCurrent && revealed)}
                              completed={answer !== null}
                              correct={answer?.correct ?? false}
                              showEnglish={showEnglish}
                              onPressTarget={
                                isCurrent
                                  ? () => {
                                      // Cancelled so the same sentence is still here on
                                      // the way back, and flagged so focus restarts it.
                                      clearGrace();
                                      cancelAdvance();
                                      resumeAdvance.current = true;
                                      // The entry shows the reading, so looking it up
                                      // mid-question counts as assistance.
                                      if (!answeredThisRound) setRevealed(true);
                                      router.push(`/lists/word/${item.entry.id}`);
                                    }
                                  : undefined
                              }
                            />
                          ) : (
                            <View className="items-center gap-4">
                              <ActivityIndicator size="large" />
                              <Text className="text-base text-muted-foreground">
                                Writing the next sentence...
                              </Text>
                            </View>
                          )}
                        </GestureScrollView>
                      </View>
                    );
                  })}
                </Animated.View>
              </View>
            </GestureDetector>
          </View>

          <View
            className="border-t border-border bg-background px-4 py-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <TextInput
              ref={inputRef}
              className="h-12 rounded-lg border border-border bg-background px-4 text-foreground text-lg"
              value={currentAnswer ? currentAnswer.typedRomaji : typedRomaji}
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
