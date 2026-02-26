import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Switch,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
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
  type CharStatus,
} from "@/lib/typing-utils";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PitchAccent, splitMorae } from "@/components/PitchAccent";
import { playEntryAudio } from "@/lib/audio";
import type { DictEntry } from "@/db/types";

// ─── Layout estimation constants ───

const ROW_HEIGHT = 80;
const AVG_WORD_WIDTH = 110;
const HEADER_HEIGHT = 52;
const PROGRESS_HEIGHT = 32;
const INPUT_HEIGHT = 80;

// ─── Types ───

type Phase = "select" | "playing" | "done";
type GameMode = "review" | "learn" | "all";
type FuriganaMode = "off" | "auto" | "on";

interface WordState {
  entry: DictEntry;
  completed: boolean;
  correct: boolean;
}

// ─── WordBlock Component ───

function WordBlock({
  word,
  isCurrent,
  typedKana,
  furiganaMode,
  autoRevealed,
  pitchVisible,
}: {
  word: WordState;
  isCurrent: boolean;
  typedKana: string;
  furiganaMode: FuriganaMode;
  autoRevealed: boolean;
  pitchVisible: boolean;
}) {
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

  return (
    <View
      className="items-center mx-2 mb-3"
      style={{ opacity: completed ? 0.4 : isCurrent ? 1 : 0.5 }}
    >
      {completed && <CoinAnimation gloss={getEnglishGloss(entry)} />}

      {/* Furigana: pitch accent with colored text, plain colored text, or invisible placeholder */}
      {showFurigana && pitch ? (
        <PitchAccent accent={pitch} renderMora={coloredMoraRenderer} />
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
    </View>
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
          position: "absolute",
          top: -20,
          left: -24,
          right: -24,
          bottom: -20,
          background:
            "radial-gradient(circle, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0.15) 40%, transparent 70%)",
        },
        style,
      ]}
      pointerEvents="none"
    />
  );
}

// ─── Coin Animation ───

function CoinAnimation({ gloss }: { gloss: string }) {
  const coinY = useSharedValue(0);
  const coinOpacity = useSharedValue(1);

  useEffect(() => {
    coinY.value = withTiming(-60, { duration: 3000, easing: Easing.out(Easing.quad) });
    coinOpacity.value = withTiming(0, { duration: 3000, easing: Easing.in(Easing.quad) });
  }, [coinY, coinOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: coinY.value }],
    opacity: coinOpacity.value,
  }));

  return (
    <Animated.View
      style={[{ position: "absolute", top: -12, zIndex: 10 }, animatedStyle]}
      pointerEvents="none"
    >
      <Text className="text-sm font-medium text-primary text-center" numberOfLines={1}>
        {gloss}
      </Text>
    </Animated.View>
  );
}

// ─── Main Screen ───

export default function TypingGameScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const goBack = useSafeGoBack("/lists");
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();

  const [phase, setPhase] = useState<Phase>("select");
  const [furiganaMode, setFuriganaMode] = useState<FuriganaMode>("auto");
  const [showPitchOpt, setShowPitchOpt] = useState(true);
  const [playAudioOpt, setPlayAudioOpt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoFuriganaRevealed, setAutoFuriganaRevealed] = useState(false);

  // Persist game options across sessions
  const SETTINGS_KEY = "typing-game-settings";

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved.furiganaMode) setFuriganaMode(saved.furiganaMode);
        if (saved.showPitchOpt !== undefined) setShowPitchOpt(saved.showPitchOpt);
        if (saved.playAudioOpt !== undefined) setPlayAudioOpt(saved.playAudioOpt);
      } catch {}
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ furiganaMode, showPitchOpt, playAudioOpt }),
    );
  }, [furiganaMode, showPitchOpt, playAudioOpt]);
  const [words, setWords] = useState<WordState[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [typedRomaji, setTypedRomaji] = useState("");
  const [typedKana, setTypedKana] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [totalWordCount, setTotalWordCount] = useState(0);

  // Counts for mode selection
  const [reviewCount, setReviewCount] = useState(0);
  const [learnCount, setLearnCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [allEntryIds, setAllEntryIds] = useState<number[]>([]);

  // Full shuffled queue (entry IDs) — batches are pulled from front
  const shuffledQueue = useRef<number[]>([]);

  // Per-word romaji answers for backspace-to-previous (reset each batch)
  const answers = useRef<string[]>([]);
  const inputRef = useRef<TextInput>(null);

  // ─── Dynamic batch size from screen dimensions ───

  const batchSize = (() => {
    const availableHeight =
      screenHeight - insets.top - HEADER_HEIGHT - PROGRESS_HEIGHT - INPUT_HEIGHT - insets.bottom;
    const availableWidth = screenWidth - 32;
    const rows = Math.max(1, Math.floor(availableHeight / ROW_HEIGHT));
    const wordsPerRow = Math.max(1, Math.floor(availableWidth / AVG_WORD_WIDTH));
    return Math.max(4, rows * wordsPerRow);
  })();

  // ─── Load counts ───

  const loadCounts = useCallback(async () => {
    if (!userDb || !listId) return;

    const allRows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ?",
      [listId],
    );
    const entryIds = allRows.map((r) => r.entry_id);
    setAllEntryIds(entryIds);
    setAllCount(entryIds.length);

    if (entryIds.length === 0) {
      setReviewCount(0);
      setLearnCount(0);
      return;
    }

    const placeholders = entryIds.map(() => "?").join(",");

    const reviewRows = await userDb.getAllAsync<{ entry_id: number }>(
      `SELECT DISTINCT s.entry_id FROM srs_cards s
       WHERE s.list_id = ? AND s.entry_id IN (${placeholders})
       AND (s.simple_stage IS NOT NULL OR s.state != 0)`,
      [listId, ...entryIds],
    );
    setReviewCount(reviewRows.length);
    setLearnCount(entryIds.length - reviewRows.length);
  }, [userDb, listId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // ─── Start Game ───

  async function loadBatch(ids: number[]): Promise<WordState[]> {
    if (!dictDb || ids.length === 0) return [];
    const entries = await getEntries(dictDb, ids);
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    return ids
      .map((id) => entryMap.get(id))
      .filter((e): e is DictEntry => e !== undefined)
      .map((entry) => ({ entry, completed: false, correct: false }));
  }

  async function startGame(mode: GameMode) {
    if (!userDb || !dictDb || !listId) return;

    let entryIds: number[];

    if (mode === "all") {
      entryIds = [...allEntryIds];
    } else if (mode === "review") {
      const placeholders = allEntryIds.map(() => "?").join(",");
      const rows = await userDb.getAllAsync<{ entry_id: number }>(
        `SELECT DISTINCT s.entry_id FROM srs_cards s
         WHERE s.list_id = ? AND s.entry_id IN (${placeholders})
         AND (s.simple_stage IS NOT NULL OR s.state != 0)`,
        [listId, ...allEntryIds],
      );
      entryIds = rows.map((r) => r.entry_id);
    } else {
      const placeholders = allEntryIds.map(() => "?").join(",");
      const reviewRows = await userDb.getAllAsync<{ entry_id: number }>(
        `SELECT DISTINCT s.entry_id FROM srs_cards s
         WHERE s.list_id = ? AND s.entry_id IN (${placeholders})
         AND (s.simple_stage IS NOT NULL OR s.state != 0)`,
        [listId, ...allEntryIds],
      );
      const learnedSet = new Set(reviewRows.map((r) => r.entry_id));
      entryIds = allEntryIds.filter((id) => !learnedSet.has(id));
    }

    // Shuffle
    for (let i = entryIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entryIds[i], entryIds[j]] = [entryIds[j], entryIds[i]];
    }

    setTotalWordCount(entryIds.length);
    setCompletedTotal(0);

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
    answers.current[currentWordIndex] = raw;

    // Reset auto-furigana before advancing so the next word doesn't flash
    setAutoFuriganaRevealed(false);

    // Play audio for the completed word
    if (playAudioOpt && dictDb) {
      playEntryAudio(dictDb, words[currentWordIndex].entry.id);
    }

    const newCompletedTotal = completedTotal + currentWordIndex + 1;
    const nextIndex = currentWordIndex + 1;
    const isBatchEnd = nextIndex >= words.length;

    setWords((prev) =>
      prev.map((w, i) =>
        i === currentWordIndex ? { ...w, completed: true, correct: isCorrect } : w,
      ),
    );

    if (isBatchEnd) {
      if (shuffledQueue.current.length > 0) {
        setTimeout(() => advanceToNextBatch(newCompletedTotal), 3000);
      } else {
        setCompletedTotal(newCompletedTotal);
        setEndTime(Date.now());
        setPhase("done");
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

    setTypedRomaji(raw);
    const converted = romajiToKana(raw);
    setTypedKana(converted);

    // Auto-furigana: reveal on mistype
    if (furiganaMode === "auto" && !autoFuriganaRevealed) {
      const statuses = compareChars(converted, getTargetReading(words[currentWordIndex].entry));
      if (statuses.some((s) => s === "wrong")) {
        setAutoFuriganaRevealed(true);
      }
    }

    const currentEntry = words[currentWordIndex].entry;
    const isCorrect =
      isReadingComplete(converted, currentEntry) || isReadingComplete(raw, currentEntry);

    if (isCorrect) {
      advanceWord(raw, true);
      return;
    }

    // If fully-converted kana count >= target reading length, move on even if wrong.
    // Only count actual kana chars — exclude unconverted ASCII romaji (e.g. trailing "d" in "いd")
    const targetLen = [...getTargetReading(currentEntry)].length;
    const kanaCount = [...converted].filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x3040 && code <= 0x30ff;
    }).length;
    if (kanaCount >= targetLen && targetLen > 0) {
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

    // Unmark the previous word
    setWords((prev) =>
      prev.map((w, i) => (i === prevIndex ? { ...w, completed: false, correct: false } : w)),
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
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => goBack()} className="p-1 mr-3">
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
              <View className="flex-row rounded-lg border border-border overflow-hidden">
                {(["off", "auto", "on"] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    className={`px-2.5 py-1 ${furiganaMode === mode ? "bg-primary" : ""}`}
                    onPress={() => setFuriganaMode(mode)}
                  >
                    <Text
                      className={`text-xs capitalize ${furiganaMode === mode ? "text-primary-foreground" : "text-foreground"}`}
                    >
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>
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
        <View className="flex-1 justify-center px-6">
          <Text className="text-xl font-bold text-foreground text-center mb-6">Choose a mode</Text>

          <View className="gap-3">
            <Button
              label={`Review (${reviewCount})`}
              onPress={() => startGame("review")}
              disabled={reviewCount === 0}
            />
            <Button
              label={`Learn (${learnCount})`}
              variant="secondary"
              onPress={() => startGame("learn")}
              disabled={learnCount === 0}
            />
            <Button
              label={`All (${allCount})`}
              variant="outline"
              onPress={() => startGame("all")}
              disabled={allCount === 0}
            />
          </View>

          {/* Options */}
          <View className="mt-6 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-foreground">Furigana</Text>
              <View className="flex-row rounded-lg border border-border overflow-hidden">
                {(["off", "auto", "on"] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    className={`px-3 py-1.5 ${furiganaMode === mode ? "bg-primary" : ""}`}
                    onPress={() => setFuriganaMode(mode)}
                  >
                    <Text
                      className={`text-sm capitalize ${furiganaMode === mode ? "text-primary-foreground" : "text-foreground"}`}
                    >
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>
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
        </View>
      )}

      {phase === "playing" && (
        <View className="flex-1">
          {/* Progress */}
          <View className="px-4 py-2">
            <Text className="text-sm text-muted-foreground text-right">
              {completedTotal + currentWordIndex}/{totalWordCount}
            </Text>
          </View>

          {/* Word area - tapping refocuses input */}
          <Pressable className="flex-1 px-4" onPress={() => inputRef.current?.focus()}>
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
                />
              ))}
            </View>
          </Pressable>

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
              onSubmitEditing={() => setAutoFuriganaRevealed(true)}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              placeholder="Type romaji..."
              placeholderTextColor="#999"
            />
          </View>
        </View>
      )}

      {phase === "done" && (
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-foreground text-center mb-6">Done!</Text>

          <View className="items-center gap-2 mb-8">
            <Text className="text-lg text-muted-foreground">
              {completedTotal} words in {Math.round(elapsedSeconds)}s
            </Text>
            <Text className="text-2xl font-semibold text-primary">{wordsPerMinute} words/min</Text>
          </View>

          <View className="gap-3">
            <Button
              label="Play Again"
              onPress={() => {
                setPhase("select");
                setWords([]);
                setCurrentWordIndex(0);
                loadCounts();
              }}
            />
            <Button label="Return to List" variant="outline" onPress={() => goBack()} />
          </View>
        </View>
      )}
    </View>
  );
}
