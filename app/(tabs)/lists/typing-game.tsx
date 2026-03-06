import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  View,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type LayoutChangeEvent,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeGoBack, WEB_BACKDROP_COLORS, WEB_CUSTOM_HEADER_TOP } from "@/lib/navigation";
import { useContainerWidth } from "@/lib/use-container-width";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GameSelectScreen } from "@/components/GameSelectScreen";
import { FloatingLabel } from "@/components/FloatingLabel";
import { X, Settings } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntries } from "@/db/search";
import {
  romajiToKana,
  getTargetReading,
  getDisplayText,
  getEnglishGloss,
  compareChars,
  isReadingComplete,
  getKanjiColor,
  hasFlickPending,
  type CharStatus,
} from "@/lib/typing-utils";
import { useAtom } from "jotai";
import {
  typingFuriganaModeAtom,
  typingShowPitchAtom,
  typingPlayAudioAtom,
  typingWordFilterAtom,
  type FuriganaMode,
} from "@/stores/settings";
import { PitchAccent, splitMorae } from "@/components/PitchAccent";
import { playEntryAudio } from "@/lib/audio";
import { logPracticeEvent, logSessionSummary, recordConfusion } from "@/lib/practice-logger";
import { findReadingConfusion, findMeaningConfusion } from "@/lib/confused-words";
import { useWordFilter } from "@/hooks/useWordFilter";
import type { DictEntry } from "@/db/types";

// ─── Layout estimation constants ───

const ROW_HEIGHT = 80;
const AVG_WORD_WIDTH = 110;
const HEADER_HEIGHT = 52;
const PROGRESS_HEIGHT = 32;
const INPUT_HEIGHT = 80;

// ─── Types ───

type Phase = "select" | "playing" | "done";
interface WordState {
  entry: DictEntry;
  completed: boolean;
  correct: boolean;
  assisted: boolean;
}

// ─── WordBlock Component ───

interface FloatingCoin {
  key: number;
  gloss: string;
  screenX: number;
  screenY: number;
}

function WordBlock({
  word,
  isCurrent,
  typedKana,
  furiganaMode,
  autoRevealed,
  pitchVisible,
  flickPending,
  onLayout,
  onCoinSpawn,
}: {
  word: WordState;
  isCurrent: boolean;
  typedKana: string;
  furiganaMode: FuriganaMode;
  autoRevealed: boolean;
  pitchVisible: boolean;
  flickPending?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  onCoinSpawn?: (coin: FloatingCoin) => void;
}) {
  const router = useRouter();
  const blockRef = useRef<View>(null);
  const hasFired = useRef(false);
  const { entry, completed, correct } = word;
  const displayText = getDisplayText(entry);
  const targetReading = getTargetReading(entry);

  // Furigana always shows on completion; otherwise depends on mode
  const showFurigana =
    completed || furiganaMode === "on" || (furiganaMode === "auto" && isCurrent && autoRevealed);

  // Pitch accent only renders alongside furigana
  const pitch =
    pitchVisible && showFurigana
      ? entry.pitchAccents.find((pa) => pa.reading === targetReading)
      : undefined;

  // For reserving placeholder height when furigana is hidden
  const pitchForReserve = pitchVisible
    ? entry.pitchAccents.find((pa) => pa.reading === targetReading)
    : undefined;

  const targetChars = [...targetReading];
  const displayChars = [...displayText];

  let charStatuses: CharStatus[] = [];
  if (isCurrent) {
    charStatuses = compareChars(typedKana, targetReading);
    // Flick keyboard: show last char as "pending" instead of "wrong"
    if (flickPending && charStatuses.length > 0) {
      const lastIdx = [...typedKana].length - 1;
      if (lastIdx >= 0 && lastIdx < charStatuses.length && charStatuses[lastIdx] === "wrong") {
        charStatuses = [...charStatuses];
        charStatuses[lastIdx] = "pending";
      }
    }
  } else if (completed && correct) {
    charStatuses = targetChars.map(() => "correct" as CharStatus);
  } else if (completed) {
    charStatuses = targetChars.map(() => "wrong" as CharStatus);
  } else {
    charStatuses = targetChars.map(() => "untyped" as CharStatus);
  }

  const completedColor = correct ? "text-green-500" : "text-red-400";

  // Build mora → char offset mapping for pitch+furigana integration
  const morae = pitch ? splitMorae(targetReading) : [];
  const moraCharOffsets: number[] = [];
  if (pitch) {
    let offset = 0;
    for (const mora of morae) {
      moraCharOffsets.push(offset);
      offset += mora.length;
    }
  }

  // Render each mora's characters with typing-feedback colors
  const coloredMoraRenderer = (mora: string, moraIndex: number) => {
    const start = moraCharOffsets[moraIndex] ?? 0;
    return (
      <View className="flex-row">
        {[...mora].map((char, ci) => {
          const charIdx = start + ci;
          return (
            <Text
              key={ci}
              className={`text-sm ${
                charStatuses[charIdx] === "correct"
                  ? "text-green-500"
                  : charStatuses[charIdx] === "wrong"
                    ? "text-red-500"
                    : charStatuses[charIdx] === "pending"
                      ? "text-green-300"
                      : "text-muted-foreground"
              }`}
            >
              {char}
            </Text>
          );
        })}
      </View>
    );
  };

  // Measure position and spawn floating coin when word completes
  useEffect(() => {
    if (completed && !hasFired.current && onCoinSpawn) {
      hasFired.current = true;
      blockRef.current?.measureInWindow((x, y, w) => {
        onCoinSpawn({
          key: entry.id,
          gloss: getEnglishGloss(entry),
          screenX: x + w / 2,
          screenY: y,
        });
      });
    }
  }, [completed, entry, onCoinSpawn]);

  return (
    <Pressable
      ref={blockRef}
      className="items-center mx-2 mb-3"
      style={{ opacity: completed ? 0.4 : isCurrent ? 1 : 0.5 }}
      onLayout={onLayout}
      onPress={() => router.push(`/lists/word/${entry.id}`)}
    >
      {/* Furigana: pitch accent with colored text, plain colored text, or invisible placeholder */}
      {showFurigana && pitch ? (
        <PitchAccent
          accent={pitch}
          renderMora={coloredMoraRenderer}
          lineColor={
            charStatuses[0] === "correct"
              ? "#22c55e"
              : charStatuses[0] === "wrong"
                ? "#ef4444"
                : charStatuses[0] === "pending"
                  ? "#86efac"
                  : "#a1a1aa"
          }
        />
      ) : showFurigana ? (
        <View className="flex-row">
          {targetChars.map((char, i) => (
            <Text
              key={i}
              className={`text-base ${
                charStatuses[i] === "correct"
                  ? "text-green-500"
                  : charStatuses[i] === "wrong"
                    ? "text-red-500"
                    : charStatuses[i] === "pending"
                      ? "text-green-300"
                      : "text-muted-foreground"
              }`}
            >
              {char}
            </Text>
          ))}
        </View>
      ) : pitchForReserve ? (
        <View style={{ opacity: 0 }} pointerEvents="none">
          <PitchAccent accent={pitchForReserve} />
        </View>
      ) : (
        <Text className="text-base text-transparent">{targetReading}</Text>
      )}

      {/* Display text — with glow on correct completion */}
      <View>
        {completed && correct && <GlowOverlay />}
        {isCurrent ? (
          <View className="flex-row">
            {displayChars.map((char, i) => {
              const color = getKanjiColor(displayChars, charStatuses, targetChars.length, i);
              const colorClass =
                color === "green"
                  ? "text-green-500"
                  : color === "red"
                    ? "text-red-500"
                    : color === "pending"
                      ? "text-green-300"
                      : "text-foreground";
              return (
                <Text key={i} className={`text-2xl font-bold ${colorClass}`}>
                  {char}
                </Text>
              );
            })}
          </View>
        ) : (
          <Text
            className={`text-2xl font-bold ${completed ? completedColor : "text-muted-foreground"}`}
          >
            {displayText}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── Glow Overlay (correct completion) ───

function GlowOverlay() {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 500 }));
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute" as const,
          top: -20,
          left: -24,
          right: -24,
          bottom: -20,
        },
        {
          background:
            "radial-gradient(circle, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0.15) 40%, transparent 70%)",
        } as any,
        style,
      ]}
      pointerEvents="none"
    />
  );
}

// ─── Main Screen ───

export default function TypingGameScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const goBack = useSafeGoBack("/lists");
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const containerWidth = useContainerWidth();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const webBgStyle =
    Platform.OS === "web"
      ? { backgroundColor: isDark ? WEB_BACKDROP_COLORS.dark : WEB_BACKDROP_COLORS.light }
      : undefined;
  const userDb = useUserDb();
  const { dictDb, audioDb } = useDatabase();

  const [navigating, setNavigating] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [furiganaMode, setFuriganaMode] = useAtom(typingFuriganaModeAtom);
  const [showPitchOpt, setShowPitchOpt] = useAtom(typingShowPitchAtom);
  const [playAudioOpt, setPlayAudioOpt] = useAtom(typingPlayAudioAtom);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoFuriganaRevealed, setAutoFuriganaRevealed] = useState(false);
  const [words, setWords] = useState<WordState[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [typedRomaji, setTypedRomaji] = useState("");
  const [typedKana, setTypedKana] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [totalWordCount, setTotalWordCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [assistedCount, setAssistedCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);

  // Word filter (SRS-based counts + filtering)
  const wordFilter = useWordFilter(listId);
  const [selectedFilter, setSelectedFilter] = useAtom(typingWordFilterAtom);

  // Full shuffled queue (entry IDs) — batches are pulled from front
  const shuffledQueue = useRef<number[]>([]);

  // Per-word romaji answers for backspace-to-previous (reset each batch)
  const answers = useRef<string[]>([]);
  // Flick keyboard detection: true when user is typing kana directly (not romaji)
  const isKanaInput = useRef(false);
  const [flickPendingState, setFlickPendingState] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const gameRef = useRef<View>(null);
  const wordYPositions = useRef<Map<number, number>>(new Map());
  const scrollOffset = useRef(0);
  const scrollViewHeight = useRef(0);
  const wordStartTime = useRef(0);
  const sessionIdRef = useRef("");
  const correctCountRef = useRef(0);

  // Floating coins rendered outside ScrollView to avoid clipping
  const [floatingCoins, setFloatingCoins] = useState<FloatingCoin[]>([]);
  const coinKeyRef = useRef(0);
  const spawnCoin = useCallback((coin: FloatingCoin) => {
    const key = ++coinKeyRef.current;
    setFloatingCoins((prev) => [...prev, { ...coin, key }]);
  }, []);
  const removeCoin = useCallback((key: number) => {
    setFloatingCoins((prev) => prev.filter((c) => c.key !== key));
  }, []);

  // ─── Dynamic batch size from screen dimensions ───

  const batchSize = (() => {
    const availableHeight =
      screenHeight - insets.top - HEADER_HEIGHT - PROGRESS_HEIGHT - INPUT_HEIGHT - insets.bottom;
    const availableWidth = containerWidth - 32;
    const rows = Math.max(1, Math.floor(availableHeight / ROW_HEIGHT));
    const wordsPerRow = Math.max(1, Math.floor(availableWidth / AVG_WORD_WIDTH));
    return Math.max(4, rows * wordsPerRow);
  })();

  // ─── Keep input focused during gameplay (web) ───

  useEffect(() => {
    if (phase !== "playing") return;
    const node = gameRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const handler = (e: Event) => {
      if ((e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
      }
    };
    node.addEventListener("mousedown", handler);
    return () => node.removeEventListener("mousedown", handler);
  }, [phase]);

  // ─── Refocus input when returning from word detail ───

  useFocusEffect(
    useCallback(() => {
      if (phase === "playing") {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }, [phase]),
  );

  // ─── Auto-scroll to current word (only when it's near/below the bottom) ───

  useEffect(() => {
    if (phase !== "playing") return;
    const y = wordYPositions.current.get(currentWordIndex);
    if (y == null || scrollViewHeight.current === 0) return;
    const wordScrollY = y + 12; // account for contentContainer paddingTop
    const bottomEdge = scrollOffset.current + scrollViewHeight.current;
    // Only scroll if the word is within one row height of the bottom edge or below it
    if (wordScrollY + ROW_HEIGHT > bottomEdge) {
      scrollRef.current?.scrollTo({ y: Math.max(0, wordScrollY - 8), animated: true });
    }
  }, [currentWordIndex, phase]);

  // Reset per-word timer when advancing to a new word
  useEffect(() => {
    wordStartTime.current = Date.now();
  }, [currentWordIndex]);

  // ─── Start Game ───

  async function loadBatch(ids: number[]): Promise<WordState[]> {
    if (!dictDb || ids.length === 0) return [];
    const entries = await getEntries(dictDb, ids);
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    return ids
      .map((id) => entryMap.get(id))
      .filter((e): e is DictEntry => e !== undefined)
      .map((entry) => ({ entry, completed: false, correct: false, assisted: false }));
  }

  async function startGame() {
    if (!dictDb || !listId) return;

    const entryIds = wordFilter.getFilteredEntryIds(selectedFilter);

    // Shuffle
    for (let i = entryIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entryIds[i], entryIds[j]] = [entryIds[j], entryIds[i]];
    }

    setTotalWordCount(entryIds.length);
    setCompletedTotal(0);
    setCorrectCount(0);
    setAssistedCount(0);
    setIncorrectCount(0);
    sessionIdRef.current = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    correctCountRef.current = 0;

    const firstBatchIds = entryIds.slice(0, batchSize);
    shuffledQueue.current = entryIds.slice(batchSize);

    const batch = await loadBatch(firstBatchIds);
    answers.current = new Array(batch.length).fill("");
    setWords(batch);
    setCurrentWordIndex(0);
    setTypedRomaji("");
    setTypedKana("");
    setStartTime(Date.now());
    setEndTime(0);
    setPhase("playing");

    setTimeout(() => inputRef.current?.focus(), 200);
  }

  async function advanceToNextBatch(prevCompleted: number) {
    wordYPositions.current.clear();
    scrollRef.current?.scrollTo({ y: 0, animated: false });

    const nextBatchIds = shuffledQueue.current.slice(0, batchSize);
    shuffledQueue.current = shuffledQueue.current.slice(batchSize);

    const batch = await loadBatch(nextBatchIds);
    answers.current = new Array(batch.length).fill("");
    setWords(batch);
    setCurrentWordIndex(0);
    setTypedRomaji("");
    setTypedKana("");
    setCompletedTotal(prevCompleted);

    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // ─── Advance to next word (or next batch / done) ───

  function advanceWord(raw: string, isCorrect: boolean) {
    const wasAssisted = autoFuriganaRevealed;
    answers.current[currentWordIndex] = raw;

    if (isCorrect && !wasAssisted) {
      setCorrectCount((c) => c + 1);
      correctCountRef.current++;
    } else if (isCorrect && wasAssisted) {
      setAssistedCount((c) => c + 1);
    } else {
      setIncorrectCount((c) => c + 1);
    }

    // Log practice event
    const responseMs = Date.now() - wordStartTime.current;
    const currentEntry = words[currentWordIndex].entry;
    const converted = romajiToKana(raw);
    if (userDb && listId) {
      logPracticeEvent(userDb, {
        entryId: currentEntry.id,
        listId,
        practiceMode: "typing_game",
        correct: isCorrect,
        assisted: wasAssisted,
        responseMs,
        typedAnswer: converted,
        sessionId: sessionIdRef.current,
      }).catch(() => {});

      // Reading-based confusion detection on incorrect answers
      if (!isCorrect && converted.length >= 2 && dictDb) {
        findReadingConfusion(
          currentEntry.id,
          converted,
          wordFilter.getFilteredEntryIds("all"),
          (ids) => getEntries(dictDb, ids),
        )
          .then((confused) => {
            if (confused) {
              recordConfusion(
                userDb,
                { entryId: currentEntry.id },
                { entryId: confused.id },
                "reading",
                listId,
                "typing_game",
              ).catch(() => {});
            }
          })
          .catch(() => {});
      }

      // Meaning-based confusion detection on incorrect answers
      if (!isCorrect) {
        const candidates = words.map((w) => w.entry);
        const meaningResults = findMeaningConfusion(currentEntry, candidates);
        for (const mr of meaningResults) {
          recordConfusion(
            userDb,
            { entryId: currentEntry.id },
            { entryId: mr.entry.id },
            "meaning",
            listId,
            "typing_game",
          ).catch(() => {});
        }
      }
    }

    // Reset state before advancing so the next word doesn't flash
    setAutoFuriganaRevealed(false);
    setFlickPendingState(false);

    // Play audio for the completed word
    if (playAudioOpt && audioDb) {
      playEntryAudio(audioDb, words[currentWordIndex].entry.id);
    }

    const newCompletedTotal = completedTotal + currentWordIndex + 1;
    const nextIndex = currentWordIndex + 1;
    const isBatchEnd = nextIndex >= words.length;

    setWords((prev) =>
      prev.map((w, i) =>
        i === currentWordIndex
          ? { ...w, completed: true, correct: isCorrect, assisted: wasAssisted }
          : w,
      ),
    );

    if (isBatchEnd) {
      if (shuffledQueue.current.length > 0) {
        setTimeout(() => advanceToNextBatch(newCompletedTotal), 1500);
      } else {
        setCompletedTotal(newCompletedTotal);
        setEndTime(Date.now());
        setPhase("done");
        if (userDb && listId) {
          logSessionSummary(userDb, {
            sessionId: sessionIdRef.current,
            listId,
            practiceMode: "typing_game",
            startedAt: new Date(startTime).toISOString(),
            durationMs: Date.now() - startTime,
            totalItems: newCompletedTotal,
            correctCount: correctCountRef.current,
          }).catch(() => {});
        }
      }
    } else {
      setCurrentWordIndex(nextIndex);
    }

    setTypedRomaji("");
    setTypedKana("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // ─── Handle Typing ───

  function handleInput(raw: string) {
    if (phase !== "playing" || currentWordIndex >= words.length) return;

    // Detect kana keyboard: if raw text ends with kana, user is on a kana/flick keyboard
    if (raw.length > 0) {
      const lastCode = raw.charCodeAt(raw.length - 1);
      isKanaInput.current = lastCode >= 0x3040 && lastCode <= 0x30ff;
    }

    setTypedRomaji(raw);
    const converted = romajiToKana(raw);
    setTypedKana(converted);

    const currentEntry = words[currentWordIndex].entry;
    const target = getTargetReading(currentEntry);

    // Check if last character is in a flick-pending state (e.g. か composing to が)
    const flickPending = isKanaInput.current && hasFlickPending(converted, target);
    setFlickPendingState(flickPending);

    // Auto-furigana: reveal on mistype (but not if flick-pending)
    if (furiganaMode === "auto" && !autoFuriganaRevealed) {
      const statuses = compareChars(converted, target);
      if (statuses.some((s) => s === "wrong") && !flickPending) {
        setAutoFuriganaRevealed(true);
      }
    }

    const isCorrect =
      isReadingComplete(converted, currentEntry) || isReadingComplete(raw, currentEntry);

    if (isCorrect) {
      advanceWord(raw, true);
      return;
    }

    // If fully-converted kana count >= target reading length, move on even if wrong.
    // Only count actual kana chars — exclude unconverted ASCII romaji (e.g. trailing "d" in "いd")
    const targetLen = [...target].length;
    const kanaCount = [...converted].filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x3040 && code <= 0x30ff;
    }).length;
    if (kanaCount >= targetLen && targetLen > 0) {
      // Don't auto-advance if the last char is a flick intermediate (e.g. か → が)
      if (flickPending) return;
      advanceWord(raw, false);
      return;
    }

    // Diagnostic: log when input isn't matching so we can debug the rare stuck state
    if (__DEV__ && converted.length >= 3) {
      console.warn("[TypingGame] no match", {
        typed: converted,
        target: getTargetReading(currentEntry),
        display: getDisplayText(currentEntry),
        index: currentWordIndex,
        wordsLen: words.length,
        completed: words[currentWordIndex].completed,
      });
    }
  }

  // ─── Backspace on empty → go to previous word ───

  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (e.nativeEvent.key !== "Backspace") return;
    if (typedRomaji !== "" || currentWordIndex === 0) return;
    if (phase !== "playing") return;

    const prevIndex = currentWordIndex - 1;
    const prevRomaji = answers.current[prevIndex] || "";

    // Decrement the counter for the previous word's result before undoing it
    const prevWord = words[prevIndex];
    if (prevWord.completed) {
      if (prevWord.correct && !prevWord.assisted) {
        setCorrectCount((c) => c - 1);
        correctCountRef.current--;
      } else if (prevWord.correct && prevWord.assisted) {
        setAssistedCount((c) => c - 1);
      } else {
        setIncorrectCount((c) => c - 1);
      }
    }

    // Unmark the previous word
    setWords((prev) =>
      prev.map((w, i) =>
        i === prevIndex ? { ...w, completed: false, correct: false, assisted: false } : w,
      ),
    );

    setAutoFuriganaRevealed(false);
    setCurrentWordIndex(prevIndex);
    setTypedRomaji(prevRomaji);
    setTypedKana(romajiToKana(prevRomaji));
  }

  // ─── Stats ───

  const elapsedSeconds = endTime > 0 ? (endTime - startTime) / 1000 : 0;
  const wordsPerMinute =
    elapsedSeconds > 0 ? Math.round((completedTotal / elapsedSeconds) * 60) : 0;

  // ─── Render ───

  return (
    <View
      ref={gameRef}
      className="flex-1 bg-background"
      style={[
        Platform.OS === "web" ? { paddingTop: WEB_CUSTOM_HEADER_TOP } : { paddingTop: insets.top },
        webBgStyle,
      ]}
      onTouchStart={() => {
        if (phase === "playing") inputRef.current?.focus();
      }}
    >
      {/* Header */}
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
        <Text className="text-lg font-semibold text-foreground flex-1">Typing Game</Text>
        {phase === "playing" && (
          <Pressable onPress={() => setSettingsOpen((v) => !v)} className="p-1">
            <Settings size={20} className="text-foreground" />
          </Pressable>
        )}
      </View>

      {/* Settings dropdown */}
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
              <Text className="text-sm text-foreground">Furigana</Text>
              <SegmentedControl
                options={[
                  { value: "off" as FuriganaMode, label: "Off" },
                  { value: "auto" as FuriganaMode, label: "Auto" },
                  { value: "on" as FuriganaMode, label: "On" },
                ]}
                value={furiganaMode}
                onChange={setFuriganaMode}
              />
            </View>
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Pitch accent</Text>
              <Switch value={showPitchOpt} onValueChange={setShowPitchOpt} />
            </View>
            <View className="flex-row items-center justify-between gap-6">
              <Text className="text-sm text-foreground">Audio on complete</Text>
              <Switch value={playAudioOpt} onValueChange={setPlayAudioOpt} />
            </View>
          </View>
        </>
      )}

      {phase === "select" && (
        <GameSelectScreen
          title="Typing Game"
          wordFilter={wordFilter}
          selectedFilter={selectedFilter}
          onFilterChange={setSelectedFilter}
          onStart={() => startGame()}
        >
          <View className="gap-3 mb-6">
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-foreground">Furigana</Text>
              <SegmentedControl
                options={[
                  { value: "off" as FuriganaMode, label: "Off" },
                  { value: "auto" as FuriganaMode, label: "Auto" },
                  { value: "on" as FuriganaMode, label: "On" },
                ]}
                value={furiganaMode}
                onChange={setFuriganaMode}
              />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-foreground">Show pitch accent</Text>
              <Switch value={showPitchOpt} onValueChange={setShowPitchOpt} />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-foreground">Audio on complete</Text>
              <Switch value={playAudioOpt} onValueChange={setPlayAudioOpt} />
            </View>
          </View>
        </GameSelectScreen>
      )}

      {phase === "playing" && (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={insets.top + HEADER_HEIGHT}
        >
          {/* Progress */}
          <View className="flex-row items-center justify-between px-4 py-2">
            {correctCount + assistedCount + incorrectCount > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Text className="text-sm font-medium text-green-500">{correctCount}</Text>
                {assistedCount > 0 && (
                  <Text className="text-sm font-medium text-yellow-500">+{assistedCount}</Text>
                )}
                <Text className="text-sm text-muted-foreground">
                  /{correctCount + assistedCount + incorrectCount}
                </Text>
              </View>
            ) : (
              <View />
            )}
            <Text className="text-sm text-muted-foreground">
              {completedTotal + currentWordIndex}/{totalWordCount}
            </Text>
          </View>

          {/* Word area - scrollable, tapping refocuses input */}
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={false}
            contentInsetAdjustmentBehavior="never"
            onScroll={(e) => {
              scrollOffset.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            onLayout={(e) => {
              scrollViewHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <Pressable onPress={() => inputRef.current?.focus()}>
              <View className="flex-row flex-wrap">
                {words.map((word, i) => (
                  <WordBlock
                    key={word.entry.id}
                    word={word}
                    isCurrent={i === currentWordIndex}
                    typedKana={i === currentWordIndex ? typedKana : ""}
                    furiganaMode={furiganaMode}
                    autoRevealed={autoFuriganaRevealed}
                    pitchVisible={showPitchOpt}
                    flickPending={i === currentWordIndex ? flickPendingState : false}
                    onCoinSpawn={spawnCoin}
                    onLayout={(e) => {
                      wordYPositions.current.set(i, e.nativeEvent.layout.y);
                    }}
                  />
                ))}
              </View>
            </Pressable>
          </ScrollView>

          {/* Input bar */}
          <View
            className="border-t border-border bg-background px-4 py-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <TextInput
              ref={inputRef}
              className="h-12 rounded-lg border border-border bg-background px-4 text-foreground text-lg"
              value={typedRomaji}
              onChangeText={handleInput}
              onKeyPress={handleKeyPress}
              blurOnSubmit={false}
              onSubmitEditing={() => {
                if (autoFuriganaRevealed) {
                  advanceWord(typedRomaji, false);
                } else {
                  setAutoFuriganaRevealed(true);
                }
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              placeholder="Type romaji..."
              placeholderTextColor="#999"
            />
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Floating coins — rendered outside ScrollView to avoid clipping */}
      {floatingCoins.map((coin) => (
        <FloatingLabel
          key={coin.key}
          text={coin.gloss}
          screenX={coin.screenX}
          screenY={coin.screenY}
          onDone={() => removeCoin(coin.key)}
        />
      ))}

      {phase === "done" && (
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-foreground text-center mb-6">Done!</Text>

          <View className="items-center gap-2 mb-8">
            <Text className="text-lg text-muted-foreground">
              {completedTotal} words in {Math.round(elapsedSeconds)}s
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text className="text-2xl font-semibold text-green-500">{correctCount}</Text>
              {assistedCount > 0 && (
                <Text className="text-2xl font-semibold text-yellow-500">+{assistedCount}</Text>
              )}
              <Text className="text-2xl font-semibold text-muted-foreground">
                /{completedTotal}
              </Text>
            </View>
            <View className="flex-row items-center gap-3">
              <Text className="text-sm text-green-500">{correctCount} correct</Text>
              {assistedCount > 0 && (
                <Text className="text-sm text-yellow-500">{assistedCount} assisted</Text>
              )}
              <Text className="text-sm text-red-400">{incorrectCount} wrong</Text>
            </View>
            <Text className="text-2xl font-semibold text-primary">{wordsPerMinute} words/min</Text>
          </View>

          <View className="gap-3">
            <Button
              label="Play Again"
              onPress={() => {
                setPhase("select");
                setWords([]);
                setCurrentWordIndex(0);
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
      {navigating && (
        <View
          className="absolute inset-0 z-50 bg-background"
          style={[
            Platform.OS === "web"
              ? { paddingTop: WEB_CUSTOM_HEADER_TOP }
              : { paddingTop: insets.top },
            webBgStyle,
          ]}
        >
          <View
            className={`py-3 ${Platform.OS === "web" ? "border-b border-border" : ""}`}
            style={webBgStyle}
          >
            <View style={{ height: 32 }} />
          </View>
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" />
          </View>
        </View>
      )}
    </View>
  );
}
