import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, TextInput, Pressable, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { X } from "@/lib/icons";
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
  type CharStatus,
} from "@/lib/typing-utils";
import type { DictEntry } from "@/db/types";

// ─── Layout estimation constants ───

// Approximate height of one word row (furigana + kanji + margin)
const ROW_HEIGHT = 80;
// Approximate average width of a word block (characters + horizontal margin)
const AVG_WORD_WIDTH = 110;
// Fixed chrome heights
const HEADER_HEIGHT = 52;
const PROGRESS_HEIGHT = 32;
const INPUT_HEIGHT = 80;
// Delay before loading next batch (lets last-word animation play)
const BATCH_TRANSITION_DELAY = 1500;

// ─── Types ───

type Phase = "select" | "playing" | "done";
type GameMode = "review" | "learn" | "all";

interface WordState {
  entry: DictEntry;
  completed: boolean;
}

// ─── WordBlock Component ───

function WordBlock({
  word,
  isCurrent,
  typedKana,
}: {
  word: WordState;
  isCurrent: boolean;
  typedKana: string;
}) {
  const { entry, completed } = word;
  const displayText = getDisplayText(entry);
  const targetReading = getTargetReading(entry);
  const hasKanji = entry.kanji.length > 0;
  const showFurigana = hasKanji;

  const targetChars = [...targetReading];

  let charStatuses: CharStatus[] = [];
  if (isCurrent) {
    charStatuses = compareChars(typedKana, targetReading);
  } else if (completed) {
    charStatuses = targetChars.map(() => "correct" as CharStatus);
  } else {
    charStatuses = targetChars.map(() => "untyped" as CharStatus);
  }

  return (
    <View
      className="items-center mx-2 mb-3"
      style={{ opacity: completed ? 0.4 : isCurrent ? 1 : 0.5 }}
    >
      {completed && <CoinAnimation gloss={getEnglishGloss(entry)} />}

      {showFurigana && (
        <View className="flex-row">
          {targetChars.map((char, i) => (
            <Text
              key={i}
              className={`text-base ${
                charStatuses[i] === "correct"
                  ? "text-green-500"
                  : charStatuses[i] === "wrong"
                    ? "text-red-500"
                    : "text-muted-foreground"
              }`}
            >
              {char}
            </Text>
          ))}
        </View>
      )}

      <Text
        className={`text-2xl font-bold ${
          completed ? "text-green-500" : isCurrent ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {displayText}
      </Text>

      {!showFurigana && isCurrent && (
        <View className="flex-row absolute top-0 left-0 right-0 items-center justify-center">
          <View className="flex-row">
            {targetChars.map((char, i) => (
              <Text
                key={i}
                className={`text-2xl font-bold ${
                  charStatuses[i] === "correct"
                    ? "text-green-500"
                    : charStatuses[i] === "wrong"
                      ? "text-red-500"
                      : "text-foreground"
                }`}
              >
                {char}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();

  const [phase, setPhase] = useState<Phase>("select");
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
  const batchTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputRef = useRef<TextInput>(null);

  // ─── Dynamic batch size from screen dimensions ───

  const batchSize = (() => {
    const availableHeight =
      screenHeight - insets.top - HEADER_HEIGHT - PROGRESS_HEIGHT - INPUT_HEIGHT - insets.bottom;
    const availableWidth = screenWidth - 32; // 16px padding each side
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

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (batchTransitionTimer.current) clearTimeout(batchTransitionTimer.current);
    };
  }, []);

  // ─── Start Game ───

  async function loadBatch(ids: number[]): Promise<WordState[]> {
    if (!dictDb || ids.length === 0) return [];
    const entries = await getEntries(dictDb, ids);
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    return ids
      .map((id) => entryMap.get(id))
      .filter((e): e is DictEntry => e !== undefined)
      .map((entry) => ({ entry, completed: false }));
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
    setWords(batch);
    setCurrentWordIndex(0);
    setTypedRomaji("");
    setTypedKana("");
    setCompletedTotal(prevCompleted);

    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // ─── Handle Typing ───

  function handleInput(raw: string) {
    if (phase !== "playing" || currentWordIndex >= words.length) return;

    setTypedRomaji(raw);
    const converted = romajiToKana(raw);
    setTypedKana(converted);

    const currentEntry = words[currentWordIndex].entry;

    if (isReadingComplete(converted, currentEntry) || isReadingComplete(raw, currentEntry)) {
      setWords((prev) =>
        prev.map((w, i) => (i === currentWordIndex ? { ...w, completed: true } : w)),
      );

      const newCompletedTotal = completedTotal + currentWordIndex + 1;
      const nextIndex = currentWordIndex + 1;

      if (nextIndex >= words.length) {
        // End of batch — delay transition so last animation can play
        if (shuffledQueue.current.length > 0) {
          batchTransitionTimer.current = setTimeout(() => {
            advanceToNextBatch(newCompletedTotal);
          }, BATCH_TRANSITION_DELAY);
        } else {
          setCompletedTotal(newCompletedTotal);
          setEndTime(Date.now());
          setPhase("done");
        }
      } else {
        setCurrentWordIndex(nextIndex);
        setTypedRomaji("");
        setTypedKana("");
      }

      setTimeout(() => {
        setTypedRomaji("");
        setTypedKana("");
        inputRef.current?.focus();
      }, 50);
    }
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
        <Pressable onPress={() => router.back()} className="p-1 mr-3">
          <X size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">Typing Game</Text>
      </View>

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
            <Button label="Return to List" variant="outline" onPress={() => router.back()} />
          </View>
        </View>
      )}
    </View>
  );
}
