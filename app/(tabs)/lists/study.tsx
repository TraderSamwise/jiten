import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Pressable,
  ActionSheetIOS,
  Platform,
  Modal,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { StudyStatisticsModal } from "@/components/StudyStatisticsModal";
import { X, Settings, Info, Check, ChevronLeft, ChevronRight, Mic } from "@/lib/icons";
import { useVoiceRecognition } from "@/lib/voice-recognition";
import { toHiragana } from "wanakana";
import { PlayAudioButton } from "@/components/PlayAudioButton";
import { playEntryAudio } from "@/lib/audio";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntries } from "@/db/search";
import { reviewCard, Rating } from "@/stores/srs";
import {
  simpleReviewPass,
  simpleReviewFail,
  simpleInitCard,
  dateToSrsEpochDays,
} from "@/stores/simple-srs";
import { useListsStore, parseListRow } from "@/stores/lists";
import {
  shouldCheckConfusion,
  findConfusedWords,
  type ConfusedWordResult,
} from "@/lib/confused-words";
import { getSimilarKanjiAsync } from "@/db/kanji-search";
import type { DictEntry, CardFace, SrsCardRow, FlashcardMode } from "@/db/types";
import type { Card as FsrsCard } from "ts-fsrs";

const CONFUSION_COOLDOWN_HOURS = 24;

const NEW_CARD_BATCH_SIZE = 5;
const CARD_PEEK = 40;
const CARD_GAP = 8;
const SWIPE_THRESHOLD = 80;
const SLIDE_DURATION = 250;
const FLIP_DURATION = 400;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// --- Self-contained typing input component ---
function TypingInput({ entry, onCorrect }: { entry: DictEntry; onCorrect: () => void }) {
  const [typedRomaji, setTypedRomaji] = useState("");
  const [typedKana, setTypedKana] = useState("");
  const [status, setStatus] = useState<"idle" | "correct" | "wrong">("idle");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  function handleInput(raw: string) {
    if (status === "correct") return;
    setTypedRomaji(raw);
    const converted = toHiragana(raw, { IMEMode: true });
    setTypedKana(converted);

    const readings = entry.kana.map((k) => k.text);
    const kanjiTexts = entry.kanji.map((k) => k.text);
    const norm = (s: string) => s.normalize("NFC");
    const isCorrect =
      readings.some((r) => norm(r) === norm(converted)) ||
      readings.some((r) => norm(r) === norm(raw)) ||
      kanjiTexts.some((k) => norm(k) === norm(raw));

    if (isCorrect) {
      setStatus("correct");
      onCorrect();
    } else {
      const anyMatch =
        readings.some((r) => norm(r).startsWith(norm(converted))) ||
        readings.some((r) => norm(r).startsWith(norm(raw)));
      setStatus(anyMatch || converted.length === 0 ? "idle" : "wrong");
    }
  }

  if (status === "correct") {
    return <Text className="text-lg font-bold text-green-500">Correct!</Text>;
  }

  const readings = entry.kana.map((k) => k.text);
  const kanjiTexts = entry.kanji.map((k) => k.text);
  const targets = kanjiTexts.some((k) => [...typedKana].some((c) => [...k].includes(c)))
    ? [...readings, ...kanjiTexts]
    : readings;
  const maxLen = Math.max(...readings.map((r) => r.length));
  const chars = [...typedKana];

  return (
    <>
      <View className="flex-row justify-center mb-3">
        {Array.from({ length: maxLen }, (_, i) => {
          if (i < chars.length) {
            const matchesAny = targets.some((r) => i < [...r].length && [...r][i] === chars[i]);
            return (
              <Text
                key={i}
                className={`text-2xl font-bold ${matchesAny ? "text-green-500" : "text-red-500"}`}
              >
                {chars[i]}
              </Text>
            );
          }
          return (
            <Text key={i} className="text-2xl text-muted-foreground/30">
              ＿
            </Text>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        className="w-48 h-10 rounded-lg border border-border bg-background px-3 text-center text-foreground text-lg"
        value={typedRomaji}
        onChangeText={handleInput}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Type reading..."
        placeholderTextColor="#999"
      />
    </>
  );
}

function getFaceText(entry: DictEntry, face: CardFace): string {
  switch (face) {
    case "kanji":
      return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
    case "kana":
      return entry.kana[0]?.text ?? "";
    case "english":
      return (
        entry.senses[0]?.glosses
          .filter((g) => g.lang === "eng")
          .map((g) => g.text)
          .join("; ") ?? ""
      );
  }
}

interface QueueItem {
  entry: DictEntry;
  srsCard?: SrsCardRow;
}

interface SrsSnapshot {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  simpleStage: number | null;
  simpleN: number | null;
  simpleInterval: number | null;
  lastConfusionCheck: string | null;
}

interface HistoryEntry {
  queueItem: QueueItem;
  action: "pass" | "easy" | "fail";
  preReviewSnapshot: SrsSnapshot | null;
  reviewLogId: string | null;
  preStudyPosition: number | null;
  wasNewSimpleSrs: boolean;
}

function captureSnapshot(card: SrsCardRow): SrsSnapshot {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
    simpleStage: card.simpleStage,
    simpleN: card.simpleN,
    simpleInterval: card.simpleInterval,
    lastConfusionCheck: card.lastConfusionCheck,
  };
}

function getCheckCount(srsCard: SrsCardRow | undefined, mode: FlashcardMode): number {
  if (!srsCard) return 0;

  if (mode === "simple_srs") {
    if (srsCard.simpleStage == null) return 0;
    if (srsCard.simpleStage === 1) return 3; // graduated
    // stage 0 (learning): 1 check after init, 2 if interval has grown
    return srsCard.simpleInterval != null && srsCard.simpleInterval > 0.5 ? 2 : 1;
  }

  if (mode === "srs") {
    if (srsCard.state === 0) return 0; // new
    if (srsCard.state === 2) return 3; // review (graduated)
    if (srsCard.state === 3) return 1; // relearning
    // state 1 (learning): use reps count
    return Math.min(srsCard.reps, 2) || 1;
  }

  return 0; // add_order — no SRS checks
}

export default function StudyScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dictDb } = useDatabase();
  const userDb = useUserDb();
  const storeList = useListsStore((s) => s.lists.find((l) => l.id === listId));
  const setLists = useListsStore((s) => s.setLists);
  const updateList = useListsStore((s) => s.updateList);

  const [localList, setLocalList] = useState<typeof storeList>(undefined);
  const list = storeList ?? localList;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionDone, setSessionDone] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const revealedRef = useRef(false);
  // Simple SRS progress: learned/total (only increments on new cards)
  const [simpleSrsLearned, setSimpleSrsLearned] = useState(0);
  const [simpleSrsTotal, setSimpleSrsTotal] = useState(0);

  // Confused words detection
  const [confusedWordsVisible, setConfusedWordsVisible] = useState(false);
  const [confusedResults, setConfusedResults] = useState<ConfusedWordResult[]>([]);
  const [confusedFailedEntry, setConfusedFailedEntry] = useState<DictEntry | null>(null);

  // Voice recognition state
  const [voiceHeard, setVoiceHeard] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "correct" | "wrong">("idle");
  const voiceAutoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceWrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History for swipe-back
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  // Carousel animation shared values
  const translateX = useSharedValue(0);
  const flipProgress = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const { width: screenWidth } = useWindowDimensions();

  const isBrowsingHistory = historyIndex !== null;
  const displayItem = isBrowsingHistory ? history[historyIndex]?.queueItem : queue[currentIndex];

  // Voice recognition: enabled when voice mode is on, card is not revealed, not browsing history
  const voiceEnabled =
    !!list?.voiceMode && !revealed && !isBrowsingHistory && !sessionDone && !loading;

  const voiceCallbackRef = useRef<(transcript: string) => void>(() => {});

  const { isListening } = useVoiceRecognition({
    enabled: voiceEnabled,
    onResult: (transcript: string) => voiceCallbackRef.current(transcript),
  });

  // Clean up voice/typing timers on unmount
  useEffect(() => {
    return () => {
      if (voiceAutoAdvanceRef.current) clearTimeout(voiceAutoAdvanceRef.current);
      if (voiceWrongTimerRef.current) clearTimeout(voiceWrongTimerRef.current);
    };
  }, []);

  // Reset voice state when card changes (typing state resets via TypingInput remount)
  useEffect(() => {
    setVoiceStatus("idle");
    setVoiceHeard(null);
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (voiceWrongTimerRef.current) {
      clearTimeout(voiceWrongTimerRef.current);
      voiceWrongTimerRef.current = null;
    }
  }, [currentIndex]);

  // Web: Enter key to reveal / advance
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const isRevealed = revealedRef.current;
      // Skip Enter in text inputs unless card is already revealed (typing mode fast-advance)
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if ((tag === "INPUT" || tag === "TEXTAREA") && !isRevealed) return;
      e.preventDefault();
      e.stopPropagation();
      if (isBrowsingHistory) return;
      if (isRevealed) {
        flipProgress.value = 1;
        setIsFlipping(false);
        handlePass(false);
      } else {
        handleReveal();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  });

  // Fetch list from DB if not in store (e.g. direct navigation, hot-reload)
  useEffect(() => {
    if (storeList || !userDb || !listId) return;
    userDb
      .getFirstAsync<any>("SELECT * FROM lists WHERE id = ?", [listId])
      .then((row) => {
        if (row) {
          const parsed = parseListRow(row);
          setLocalList(parsed);
          setLists([...useListsStore.getState().lists, parsed]);
        }
      })
      .catch(() => {});
  }, [userDb, listId, storeList]);

  useEffect(() => {
    if (dictDb && userDb && list) loadQueue();
  }, [dictDb, userDb, list?.id]);

  async function loadQueue() {
    if (!dictDb || !userDb || !list || !listId) return;
    setLoading(true);
    setHistory([]);
    setHistoryIndex(null);
    translateX.value = 0;

    try {
      if (list.flashcardMode === "add_order") {
        let position = list.studyPosition ?? 0;
        let rows = await userDb.getAllAsync<{ entry_id: number }>(
          "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at ASC LIMIT 10 OFFSET ?",
          [listId, position],
        );

        // Wrap around to start if we've passed the end
        if (rows.length === 0 && position > 0) {
          position = 0;
          await userDb.runAsync(
            "UPDATE lists SET study_position = 0, updated_at = ? WHERE id = ?",
            [new Date().toISOString(), listId],
          );
          updateList(listId, { studyPosition: 0, updatedAt: new Date().toISOString() });
          rows = await userDb.getAllAsync<{ entry_id: number }>(
            "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at ASC LIMIT 10 OFFSET 0",
            [listId],
          );
        }

        if (rows.length === 0) {
          setQueue([]);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        const entryIds = rows.map((r: { entry_id: number }) => r.entry_id);
        const entries = await getEntries(dictDb, entryIds);
        const entryMap = new Map(entries.map((e: DictEntry) => [e.id, e]));
        const items: QueueItem[] = entryIds
          .map((eid: number) => entryMap.get(eid))
          .filter((e: DictEntry | undefined): e is DictEntry => e !== undefined)
          .map((entry: DictEntry) => ({ entry }));

        setQueue(items);
        setCurrentIndex(0);
        setRevealed(false);
        setSessionDone(items.length === 0);
      } else if (list.flashcardMode === "simple_srs") {
        // Simple SRS mode: due review cards first, then new cards
        const simpleSrsSelect = `SELECT id, entry_id as entryId, list_id as listId, due,
          stability, difficulty, elapsed_days as elapsedDays,
          scheduled_days as scheduledDays, reps, lapses, state,
          last_review as lastReview, front_mode as frontMode,
          back_mode as backMode, created_at as createdAt,
          updated_at as updatedAt,
          simple_stage as simpleStage, simple_n as simpleN,
          simple_interval as simpleInterval,
          last_confusion_check as lastConfusionCheck`;

        // Ensure srs_cards exist for all list entries (auto-create if missing)
        const cardCount = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ?",
          [listId],
        );
        if (!cardCount || cardCount.c === 0) {
          const entryRows = await userDb.getAllAsync<{ entry_id: number }>(
            "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at ASC",
            [listId],
          );
          const now = new Date().toISOString();
          for (const row of entryRows) {
            await userDb.runAsync(
              `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 'kanji', 'english', ?, ?)`,
              [generateId(), row.entry_id, listId, now, now, now],
            );
          }
        }

        // Load learned/total counts for progress display
        const totalRow = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ?",
          [listId],
        );
        const learnedRow = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND simple_stage IS NOT NULL",
          [listId],
        );
        setSimpleSrsTotal(totalRow?.c ?? 0);
        setSimpleSrsLearned(learnedRow?.c ?? 0);

        const nowDays = dateToSrsEpochDays();

        // Due cards: have SRS data and n + interval <= now
        const dueRows = await userDb.getAllAsync<SrsCardRow>(
          `${simpleSrsSelect} FROM srs_cards
           WHERE list_id = ? AND simple_stage IS NOT NULL AND (simple_n + simple_interval) <= ?
           ORDER BY (simple_n + simple_interval) ASC`,
          [listId, nowDays],
        );

        // New cards: no SRS data yet (simpleStage IS NULL)
        const newRows = await userDb.getAllAsync<SrsCardRow>(
          `${simpleSrsSelect} FROM srs_cards
           WHERE list_id = ? AND simple_stage IS NULL
           ORDER BY created_at ASC LIMIT ?`,
          [listId, NEW_CARD_BATCH_SIZE],
        );

        const srsRows = [...dueRows, ...newRows];

        if (srsRows.length === 0) {
          setQueue([]);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        const entryIds = srsRows.map((r: SrsCardRow) => r.entryId);
        const entries = await getEntries(dictDb, entryIds);
        const entryMap = new Map(entries.map((e: DictEntry) => [e.id, e]));
        const items: QueueItem[] = srsRows
          .map((card: SrsCardRow) => {
            const entry = entryMap.get(card.entryId);
            return entry ? { entry, srsCard: card } : null;
          })
          .filter((item: QueueItem | null): item is QueueItem => item !== null);

        setQueue(items);
        setCurrentIndex(0);
        setRevealed(false);
        setSessionDone(items.length === 0);
      } else {
        // FSRS mode: reviews first, then a batch of new cards
        const srsSelect = `SELECT id, entry_id as entryId, list_id as listId, due,
          stability, difficulty, elapsed_days as elapsedDays,
          scheduled_days as scheduledDays, reps, lapses, state,
          last_review as lastReview, front_mode as frontMode,
          back_mode as backMode, created_at as createdAt,
          updated_at as updatedAt,
          simple_stage as simpleStage, simple_n as simpleN,
          simple_interval as simpleInterval,
          last_confusion_check as lastConfusionCheck`;

        const reviewRows = await userDb.getAllAsync<SrsCardRow>(
          `${srsSelect} FROM srs_cards WHERE list_id = ? AND state != 0 AND due <= ? ORDER BY due ASC`,
          [listId, new Date().toISOString()],
        );

        const newRows = await userDb.getAllAsync<SrsCardRow>(
          `${srsSelect} FROM srs_cards WHERE list_id = ? AND state = 0 ORDER BY created_at ASC LIMIT ?`,
          [listId, NEW_CARD_BATCH_SIZE],
        );

        const srsRows = [...reviewRows, ...newRows];

        if (srsRows.length === 0) {
          setQueue([]);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        const entryIds = srsRows.map((r: SrsCardRow) => r.entryId);
        const entries = await getEntries(dictDb, entryIds);
        const entryMap = new Map(entries.map((e: DictEntry) => [e.id, e]));
        const items: QueueItem[] = srsRows
          .map((card: SrsCardRow) => {
            const entry = entryMap.get(card.entryId);
            return entry ? { entry, srsCard: card } : null;
          })
          .filter((item: QueueItem | null): item is QueueItem => item !== null);

        setQueue(items);
        setCurrentIndex(0);
        setRevealed(false);
        setSessionDone(items.length === 0);
      }
    } catch (err) {
      console.error("loadQueue error:", err);
    }
    setLoading(false);
  }

  async function handleFail() {
    // Cancel voice auto-advance if pending
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (isBrowsingHistory) {
      await reRateFromHistory("fail", false);
      return;
    }
    if (currentIndex >= queue.length) return;

    const item = queue[currentIndex];
    const card = item.srsCard;
    const snapshot = card ? captureSnapshot(card) : null;
    let reviewLogId: string | null = null;

    if (list?.flashcardMode === "simple_srs" && card) {
      await rateSimpleSrsCard(card, false);
    } else if (list?.flashcardMode === "srs" && card) {
      reviewLogId = generateId();
      await rateSrsCard(card, Rating.Again, reviewLogId);
    }

    setHistory((h) => [
      ...h,
      {
        queueItem: item,
        action: "fail",
        preReviewSnapshot: snapshot,
        reviewLogId,
        preStudyPosition: null,
        wasNewSimpleSrs: card ? card.simpleStage == null : false,
      },
    ]);

    // Check for confused words (fire-and-forget, modal appears async)
    if (card && list?.flashcardMode !== "add_order") {
      checkForConfusedWords(item.entry, card);
    }

    // Push failed card to end of queue for re-review
    const failedItem = queue[currentIndex];
    const newQueue = [...queue, failedItem];
    setQueue(newQueue);
    advance(newQueue);
  }

  async function handlePass(isLongPress: boolean) {
    // Cancel voice auto-advance if pending
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (isBrowsingHistory) {
      await reRateFromHistory(isLongPress ? "easy" : "pass", isLongPress);
      return;
    }
    if (currentIndex >= queue.length) return;

    const item = queue[currentIndex];
    const card = item.srsCard;
    const snapshot = card ? captureSnapshot(card) : null;
    let reviewLogId: string | null = null;
    let preStudyPosition: number | null = null;
    const wasNewSimpleSrs = card ? card.simpleStage == null : false;

    if (list?.flashcardMode === "add_order") {
      if (!userDb || !listId) return;
      const currentList = useListsStore.getState().lists.find((l) => l.id === listId);
      preStudyPosition = currentList?.studyPosition ?? 0;
      await userDb.runAsync(
        "UPDATE lists SET study_position = study_position + 1, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), listId],
      );
      if (currentList) {
        updateList(listId, {
          studyPosition: (currentList.studyPosition ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (list?.flashcardMode === "simple_srs" && card) {
      await rateSimpleSrsCard(card, true);
    } else if (card) {
      const rating = isLongPress ? Rating.Easy : Rating.Good;
      reviewLogId = generateId();
      await rateSrsCard(card, rating, reviewLogId);
    }

    setHistory((h) => [
      ...h,
      {
        queueItem: item,
        action: isLongPress ? "easy" : "pass",
        preReviewSnapshot: snapshot,
        reviewLogId,
        preStudyPosition,
        wasNewSimpleSrs,
      },
    ]);

    setReviewedCount((c) => c + 1);
    advance(queue);
  }

  async function rateSrsCard(card: SrsCardRow, rating: Rating, logId?: string) {
    if (!userDb) return;

    const fsrsCard: FsrsCard = {
      due: new Date(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsedDays,
      scheduled_days: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.lastReview ? new Date(card.lastReview) : undefined,
      learning_steps: 0,
    };

    const result = reviewCard(fsrsCard, rating);
    const updated = result.card;
    const now = new Date().toISOString();

    await userDb.runAsync(
      `UPDATE srs_cards SET
        due = ?, stability = ?, difficulty = ?,
        elapsed_days = ?, scheduled_days = ?,
        reps = ?, lapses = ?, state = ?,
        last_review = ?, updated_at = ?
       WHERE id = ?`,
      [
        updated.due.toISOString(),
        updated.stability,
        updated.difficulty,
        updated.elapsed_days,
        updated.scheduled_days,
        updated.reps,
        updated.lapses,
        updated.state,
        updated.last_review?.toISOString() ?? now,
        now,
        card.id,
      ],
    );

    await userDb.runAsync(
      `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId ?? generateId(),
        card.id,
        rating,
        card.state,
        card.due,
        card.stability,
        card.difficulty,
        card.elapsedDays,
        card.scheduledDays,
        now,
      ],
    );
  }

  async function rateSimpleSrsCard(card: SrsCardRow, pass: boolean) {
    if (!userDb) return;
    const now = new Date().toISOString();

    // If card has never been reviewed (simpleStage is null), initialize it
    const isNew = card.simpleStage == null;
    let updates: { simpleStage: number; simpleN: number; simpleInterval: number };

    if (isNew && pass) {
      updates = simpleInitCard();
      // Initialize then immediately graduate
      updates = simpleReviewPass({ ...card, ...updates });
    } else if (isNew) {
      updates = simpleInitCard();
    } else if (pass) {
      updates = simpleReviewPass(card);
    } else {
      updates = simpleReviewFail(card);
    }

    await userDb.runAsync(
      `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?,
        reps = reps + 1, lapses = lapses + ?, updated_at = ? WHERE id = ?`,
      [updates.simpleStage, updates.simpleN, updates.simpleInterval, pass ? 0 : 1, now, card.id],
    );

    if (isNew) {
      setSimpleSrsLearned((c) => c + 1);
    }
  }

  async function checkForConfusedWords(entry: DictEntry, card: SrsCardRow) {
    if (!userDb || !dictDb || !listId) return;
    if (list?.confusionDetection === false) return;
    if (list?.flashcardMode === "add_order") return;

    // Check cooldown: skip if we checked this card recently
    if (card.lastConfusionCheck) {
      const lastCheck = new Date(card.lastConfusionCheck).getTime();
      const cooldownMs = CONFUSION_COOLDOWN_HOURS * 60 * 60 * 1000;
      if (Date.now() - lastCheck < cooldownMs) return;
    }

    // Use post-review reps/lapses (the +1 hasn't been written to the card object yet)
    if (!shouldCheckConfusion(card.reps + 1, card.lapses + 1)) return;

    // Get all entry_ids in the list (excluding the failed one)
    const rows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ? AND entry_id != ?",
      [listId, entry.id],
    );
    const entryIds = rows.map((r) => r.entry_id);
    if (entryIds.length === 0) return;

    const results = await findConfusedWords(
      entry,
      entryIds,
      (literal, limit) => getSimilarKanjiAsync(dictDb, literal, limit),
      (ids) => getEntries(dictDb, ids),
    );

    // Record the check timestamp regardless of results
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE srs_cards SET last_confusion_check = ? WHERE id = ?", [
      now,
      card.id,
    ]);

    if (results.length > 0) {
      setConfusedFailedEntry(entry);
      setConfusedResults(results);
      setConfusedWordsVisible(true);
    }
  }

  async function handleAddConfusedToReview(result: ConfusedWordResult) {
    if (!userDb || !listId) return;

    // Find the srs_card for this confused entry
    const cardRow = await userDb.getFirstAsync<SrsCardRow>(
      `SELECT id, entry_id as entryId, list_id as listId, due,
        stability, difficulty, elapsed_days as elapsedDays,
        scheduled_days as scheduledDays, reps, lapses, state,
        last_review as lastReview, front_mode as frontMode,
        back_mode as backMode, created_at as createdAt,
        updated_at as updatedAt,
        simple_stage as simpleStage, simple_n as simpleN,
        simple_interval as simpleInterval,
        last_confusion_check as lastConfusionCheck
       FROM srs_cards WHERE list_id = ? AND entry_id = ?`,
      [listId, result.entry.id],
    );

    if (cardRow) {
      // Fail it so it comes up soon
      if (list?.flashcardMode === "simple_srs") {
        await rateSimpleSrsCard(cardRow, false);
      } else if (list?.flashcardMode === "srs") {
        await rateSrsCard(cardRow, Rating.Again);
      }

      // Push to end of current session queue
      setQueue((q) => [...q, { entry: result.entry as DictEntry, srsCard: cardRow }]);
    }
  }

  function advance(currentQueue: QueueItem[]) {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= currentQueue.length) {
      loadQueue();
    } else {
      // Animate row left to reveal the next card (already pre-rendered in allCards)
      translateX.value = withTiming(translateX.value - slideDistance, slideConfig);
      setCurrentIndex(nextIndex);
      revealedRef.current = false;
      setRevealed(false);
      setIsFlipping(false);
    }
  }

  // Navigation: only update state. translateX is handled by callers (gesture/button animations).
  function goBack() {
    setIsFlipping(false);
    if (isBrowsingHistory) {
      if (historyIndex! > 0) {
        setHistoryIndex(historyIndex! - 1);
        setRevealed(true);
      }
    } else if (history.length > 0) {
      setHistoryIndex(history.length - 1);
      setRevealed(true);
    }
  }

  function goForward() {
    setIsFlipping(false);
    if (!isBrowsingHistory) return;
    if (historyIndex! < history.length - 1) {
      setHistoryIndex(historyIndex! + 1);
      setRevealed(true);
    } else {
      setHistoryIndex(null);
      setRevealed(false);
    }
  }

  async function undoReviewDb(entry: HistoryEntry) {
    if (!userDb || !listId) return;
    const card = entry.queueItem.srsCard;
    const snap = entry.preReviewSnapshot;
    const now = new Date().toISOString();

    if (list?.flashcardMode === "srs" && card && snap) {
      // Restore FSRS fields
      await userDb.runAsync(
        `UPDATE srs_cards SET
          due = ?, stability = ?, difficulty = ?,
          elapsed_days = ?, scheduled_days = ?,
          reps = ?, lapses = ?, state = ?,
          last_review = ?, updated_at = ?
         WHERE id = ?`,
        [
          snap.due,
          snap.stability,
          snap.difficulty,
          snap.elapsedDays,
          snap.scheduledDays,
          snap.reps,
          snap.lapses,
          snap.state,
          snap.lastReview,
          now,
          card.id,
        ],
      );
      // Delete review log
      if (entry.reviewLogId) {
        await userDb.runAsync("DELETE FROM review_logs WHERE id = ?", [entry.reviewLogId]);
      }
    } else if (list?.flashcardMode === "simple_srs" && card && snap) {
      // Restore simple SRS fields
      await userDb.runAsync(
        `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?,
          reps = ?, lapses = ?, last_confusion_check = ?, updated_at = ? WHERE id = ?`,
        [
          snap.simpleStage,
          snap.simpleN,
          snap.simpleInterval,
          snap.reps,
          snap.lapses,
          snap.lastConfusionCheck,
          now,
          card.id,
        ],
      );
      if (entry.wasNewSimpleSrs) {
        setSimpleSrsLearned((c) => Math.max(0, c - 1));
      }
    } else if (list?.flashcardMode === "add_order" && entry.preStudyPosition != null) {
      // Restore study_position
      await userDb.runAsync("UPDATE lists SET study_position = ?, updated_at = ? WHERE id = ?", [
        entry.preStudyPosition,
        now,
        listId,
      ]);
      updateList(listId, {
        studyPosition: entry.preStudyPosition,
        updatedAt: now,
      });
    }

    // Decrement reviewed count for pass/easy
    if (entry.action === "pass" || entry.action === "easy") {
      setReviewedCount((c) => Math.max(0, c - 1));
    }
  }

  async function reRateFromHistory(action: "pass" | "easy" | "fail", isLongPress: boolean) {
    if (historyIndex == null) return;

    // Undo entries from historyIndex to end, in reverse order
    const toUndo = history.slice(historyIndex);
    for (let i = toUndo.length - 1; i >= 0; i--) {
      await undoReviewDb(toUndo[i]);
    }

    // Truncate history and exit browse mode
    const truncated = history.slice(0, historyIndex);
    setHistory(truncated);
    const reReviewIndex = findQueueIndex(history[historyIndex].queueItem);
    setHistoryIndex(null);
    setCurrentIndex(reReviewIndex);
    setRevealed(false);

    // Now apply the new rating via normal flow
    // We need to wait for state to settle, so we call the rating directly
    const item = queue[reReviewIndex];
    const card = item.srsCard;
    const snapshot = card ? captureSnapshot(card) : null;
    let reviewLogId: string | null = null;
    let preStudyPosition: number | null = null;
    const wasNewSimpleSrs = card ? card.simpleStage == null : false;

    if (action === "fail") {
      if (list?.flashcardMode === "simple_srs" && card) {
        await rateSimpleSrsCard(card, false);
      } else if (list?.flashcardMode === "srs" && card) {
        reviewLogId = generateId();
        await rateSrsCard(card, Rating.Again, reviewLogId);
      }

      setHistory([
        ...truncated,
        {
          queueItem: item,
          action: "fail",
          preReviewSnapshot: snapshot,
          reviewLogId,
          preStudyPosition: null,
          wasNewSimpleSrs,
        },
      ]);

      // Push failed card to end
      const newQueue = [...queue, item];
      setQueue(newQueue);
      advanceFrom(reReviewIndex, newQueue);
    } else {
      if (list?.flashcardMode === "add_order") {
        if (!userDb || !listId) return;
        const currentList = useListsStore.getState().lists.find((l) => l.id === listId);
        preStudyPosition = currentList?.studyPosition ?? 0;
        await userDb.runAsync(
          "UPDATE lists SET study_position = study_position + 1, updated_at = ? WHERE id = ?",
          [new Date().toISOString(), listId],
        );
        if (currentList) {
          updateList(listId, {
            studyPosition: (currentList.studyPosition ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          });
        }
      } else if (list?.flashcardMode === "simple_srs" && card) {
        await rateSimpleSrsCard(card, true);
      } else if (card) {
        const rating = isLongPress ? Rating.Easy : Rating.Good;
        reviewLogId = generateId();
        await rateSrsCard(card, rating, reviewLogId);
      }

      setHistory([
        ...truncated,
        {
          queueItem: item,
          action: isLongPress ? "easy" : "pass",
          preReviewSnapshot: snapshot,
          reviewLogId,
          preStudyPosition,
          wasNewSimpleSrs,
        },
      ]);

      setReviewedCount((c) => c + 1);
      advanceFrom(reReviewIndex, queue);
    }
  }

  function findQueueIndex(item: QueueItem): number {
    // Find the queue index that matches this item
    const idx = queue.findIndex(
      (q) => q.entry.id === item.entry.id && q.srsCard?.id === item.srsCard?.id,
    );
    return idx >= 0 ? idx : currentIndex;
  }

  function advanceFrom(fromIndex: number, currentQueue: QueueItem[]) {
    const nextIndex = fromIndex + 1;
    if (nextIndex >= currentQueue.length) {
      loadQueue();
    } else {
      translateX.value = withTiming(translateX.value - slideDistance, slideConfig);
      setCurrentIndex(nextIndex);
      setRevealed(false);
      setIsFlipping(false);
    }
  }

  function handlePassPressIn() {
    isLongPressRef.current = false;
    setLongPressActive(false);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setLongPressActive(true);
    }, 500);
  }

  function handlePassPressOut() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const wasLongPress = isLongPressRef.current;
    setLongPressActive(false);
    handlePass(wasLongPress);
  }

  function handleGear() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Options", "Statistics", "Cancel"],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) setSettingsVisible(true);
          if (index === 1) setStatsVisible(true);
        },
      );
    } else {
      setMenuVisible(true);
    }
  }

  // --- Carousel measurements ---
  const containerWidth = screenWidth - 32; // px-4 = 16px each side
  const cardWidth = containerWidth - 2 * CARD_PEEK - 2 * CARD_GAP;
  const slideDistance = cardWidth + CARD_GAP;
  const slideConfig = { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) };

  // --- All cards in a single row (no content swapping — eliminates flash) ---
  const allCards = useMemo(() => {
    const cards: Array<{ item: QueueItem; isRevealed: boolean; isCurrent: boolean }> = [];
    history.forEach((h) => {
      cards.push({ item: h.queueItem, isRevealed: true, isCurrent: false });
    });
    if (!sessionDone && queue[currentIndex]) {
      cards.push({ item: queue[currentIndex], isRevealed: revealed, isCurrent: true });
    }
    // Pre-render next card so advance animation has something to slide to
    if (!sessionDone && currentIndex + 1 < queue.length) {
      cards.push({ item: queue[currentIndex + 1], isRevealed: false, isCurrent: false });
    }
    return cards;
  }, [history, queue, currentIndex, revealed, sessionDone]);

  const focusedCardIndex = isBrowsingHistory ? historyIndex! : history.length;
  const hasPrev = focusedCardIndex > 0;
  const hasNext = focusedCardIndex < history.length; // can only navigate forward within history

  // --- Handle reveal with flip ---
  function handleReveal() {
    if (revealed) return;
    revealedRef.current = true;
    setRevealed(true);
    setIsFlipping(true);
    flipProgress.value = 0;
    flipProgress.value = withTiming(
      1,
      { duration: FLIP_DURATION, easing: Easing.inOut(Easing.ease) },
      (finished) => {
        if (finished) runOnJS(setIsFlipping)(false);
      },
    );
    if (list?.autoPlayAudio && dictDb && displayItem) {
      playEntryAudio(dictDb, displayItem.entry.id);
    }
  }

  // --- Voice recognition callback (needs handleReveal + handlePass) ---
  voiceCallbackRef.current = (transcript: string) => {
    if (revealed || !displayItem) return;

    const heard = toHiragana(transcript, { passRomaji: true });
    const readings = displayItem.entry.kana.map((k) => k.text);
    const isCorrect = readings.some((r) => r === heard);

    if (isCorrect) {
      setVoiceStatus("correct");
      setVoiceHeard(null);
      handleReveal();
      voiceAutoAdvanceRef.current = setTimeout(() => {
        handlePass(false);
        setVoiceStatus("idle");
      }, 2000);
    } else {
      setVoiceStatus("wrong");
      setVoiceHeard(transcript);
      voiceWrongTimerRef.current = setTimeout(() => {
        setVoiceStatus("idle");
        setVoiceHeard(null);
      }, 1500);
    }
  };

  // --- Animated navigation wrappers ---
  function goBackAnimated() {
    if (!hasPrev) return;
    translateX.value = withTiming(translateX.value + slideDistance, slideConfig, () => {
      runOnJS(goBack)();
    });
  }

  function goForwardAnimated() {
    if (!hasNext) return;
    translateX.value = withTiming(translateX.value - slideDistance, slideConfig, () => {
      runOnJS(goForward)();
    });
  }

  // --- Gesture handling ---
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-15, 15])
        .failOffsetY([-15, 15])
        .onStart(() => {
          gestureStartX.value = translateX.value;
        })
        .onUpdate((e) => {
          const tx = e.translationX;
          if (tx > 0 && !hasPrev) {
            translateX.value = gestureStartX.value + tx * 0.3;
          } else if (tx < 0 && !hasNext) {
            translateX.value = gestureStartX.value + tx * 0.3;
          } else {
            translateX.value = gestureStartX.value + tx;
          }
        })
        .onEnd((e) => {
          if (e.translationX > SWIPE_THRESHOLD && hasPrev) {
            // Animate to show prev card, then update state
            translateX.value = withTiming(gestureStartX.value + slideDistance, slideConfig, () => {
              runOnJS(goBack)();
            });
          } else if (e.translationX < -SWIPE_THRESHOLD && hasNext) {
            // Animate to show next card, then update state
            translateX.value = withTiming(gestureStartX.value - slideDistance, slideConfig, () => {
              runOnJS(goForward)();
            });
          } else {
            translateX.value = withTiming(gestureStartX.value, slideConfig);
          }
        }),
    [hasPrev, hasNext, slideDistance],
  );

  const tapGesture = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(handleReveal)()),
    [revealed, list?.autoPlayAudio, dictDb, displayItem],
  );

  const composedGesture = useMemo(
    () => Gesture.Exclusive(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  // --- Animated styles ---
  const rowStyle = useAnimatedStyle(() => ({
    flexDirection: "row" as const,
    alignItems: "stretch" as const,
    transform: [{ translateX: translateX.value }],
  }));

  const frontFaceStyle = useAnimatedStyle(() => {
    const rotateX = interpolate(flipProgress.value, [0, 0.5], [0, 90]);
    const opacity = flipProgress.value < 0.5 ? 1 : 0;
    return {
      backfaceVisibility: "hidden" as const,
      transform: [{ perspective: 1000 }, { rotateX: `${rotateX}deg` }],
      opacity,
    };
  });

  const backFaceStyle = useAnimatedStyle(() => {
    const rotateX = interpolate(flipProgress.value, [0.5, 1], [-90, 0]);
    const opacity = flipProgress.value >= 0.5 ? 1 : 0;
    return {
      backfaceVisibility: "hidden" as const,
      transform: [{ perspective: 1000 }, { rotateX: `${rotateX}deg` }],
      opacity,
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  });

  // --- Card content helpers ---
  const frontFaces = list?.frontFaces ?? ["kanji"];
  const backFaces = list?.backFaces ?? ["english"];

  function renderCardFront(item: QueueItem, isCurrent: boolean) {
    return (
      <View className="items-center justify-center flex-1">
        <Text className="text-3xl font-bold text-foreground">
          {getFaceText(item.entry, frontFaces[0])}
        </Text>
        {frontFaces.slice(1).map((face, i) => (
          <Text key={`front-${i}`} className="mt-1 text-lg text-muted-foreground">
            {getFaceText(item.entry, face)}
          </Text>
        ))}
        {list?.typingMode && isCurrent && !isBrowsingHistory ? (
          <View className="mt-6 items-center w-full px-4">
            <TypingInput
              key={item.entry.id}
              entry={item.entry}
              onCorrect={() => {
                handleReveal();
              }}
            />
          </View>
        ) : list?.voiceMode ? (
          <View className="mt-6 items-center">
            {voiceStatus === "correct" ? (
              <Text className="text-lg font-bold text-green-500">Correct!</Text>
            ) : voiceStatus === "wrong" ? (
              <>
                <Text className="text-lg font-bold text-red-500">Try again</Text>
                {voiceHeard && (
                  <Text className="text-sm text-muted-foreground mt-1">Heard: {voiceHeard}</Text>
                )}
              </>
            ) : (
              <>
                <Mic size={24} className={isListening ? "text-primary" : "text-muted-foreground"} />
                <Text className="text-sm text-muted-foreground mt-1">Say the reading...</Text>
              </>
            )}
          </View>
        ) : (
          <Text className="mt-6 text-sm text-muted-foreground">Tap to reveal</Text>
        )}
      </View>
    );
  }

  function renderCardRevealed(item: QueueItem) {
    return (
      <View className="items-center justify-center flex-1">
        <Text className="text-lg text-muted-foreground">
          {getFaceText(item.entry, frontFaces[0])}
        </Text>
        {frontFaces.slice(1).map((face, i) => (
          <Text key={`front-${i}`} className="mt-1 text-sm text-muted-foreground">
            {getFaceText(item.entry, face)}
          </Text>
        ))}
        <View className="mt-6 items-center">
          <View className="h-px w-32 bg-border mb-4" />
          <Text className="text-3xl font-bold text-foreground">
            {getFaceText(item.entry, backFaces[0])}
          </Text>
          {backFaces.slice(1).map((face, i) => (
            <Text key={`back-${i}`} className="mt-2 text-3xl text-muted-foreground">
              {getFaceText(item.entry, face)}
            </Text>
          ))}
          <View className="mt-3">
            <PlayAudioButton entryId={item.entry.id} size={22} />
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        style={{ paddingTop: insets.top }}
      >
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  if (sessionDone) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background px-8"
        style={{ paddingTop: insets.top }}
      >
        <Text className="text-4xl mb-4">
          {reviewedCount > 0 ? "All done!" : "Nothing to study!"}
        </Text>
        <Text className="text-lg text-muted-foreground text-center mb-2">
          {reviewedCount > 0
            ? `You reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
            : list?.flashcardMode === "add_order"
              ? "You've studied all cards in this list. You can reset your position in settings."
              : "No cards are due and no new cards remain."}
        </Text>
        <Button
          className="mt-4"
          label="Return to List"
          variant="outline"
          onPress={() => router.back()}
        />
      </View>
    );
  }

  const currentItem = displayItem;
  const isSimpleSrs = list?.flashcardMode === "simple_srs";
  const total = queue.length;
  const progress = isSimpleSrs
    ? simpleSrsTotal > 0
      ? (simpleSrsLearned / simpleSrsTotal) * 100
      : 0
    : total > 0
      ? (currentIndex / total) * 100
      : 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2">
          <X size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-sm text-muted-foreground">
          {isBrowsingHistory
            ? `← ${historyIndex! + 1} / ${history.length}`
            : isSimpleSrs
              ? `${simpleSrsLearned} / ${simpleSrsTotal}`
              : `${currentIndex + 1} / ${total}`}
        </Text>
        <Pressable onPress={handleGear} className="p-2">
          <Settings size={20} className="text-foreground" />
        </Pressable>
      </View>

      {/* Progress bar */}
      <View className="h-1 bg-border mx-4 rounded-full overflow-hidden">
        <View className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
      </View>

      {/* Carousel — all cards rendered in one row, scroll via translateX */}
      <GestureDetector gesture={composedGesture}>
        <View className="flex-1 pt-4" style={{ overflow: "hidden", paddingHorizontal: 16 }}>
          <Animated.View
            style={[
              rowStyle,
              {
                marginLeft: CARD_PEEK + CARD_GAP,
                width: allCards.length * cardWidth + Math.max(0, allCards.length - 1) * CARD_GAP,
                flex: 1,
                maxHeight: 384,
              },
            ]}
          >
            {allCards.map((card, i) => {
              const isFocused = i === focusedCardIndex;
              return (
                <View
                  key={i}
                  style={{
                    width: cardWidth,
                    marginRight: i < allCards.length - 1 ? CARD_GAP : 0,
                  }}
                >
                  <Card
                    className="flex-1 items-center justify-center"
                    style={{ opacity: isFocused ? 1 : 0.6, position: "relative" }}
                  >
                    {isFocused && currentItem && (
                      <View
                        style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
                        className="flex-row items-center gap-1"
                      >
                        {Array.from(
                          {
                            length: getCheckCount(
                              currentItem.srsCard,
                              list?.flashcardMode ?? "add_order",
                            ),
                          },
                          (_, ci) => (
                            <Check
                              key={ci}
                              size={14}
                              className={
                                getCheckCount(
                                  currentItem.srsCard,
                                  list?.flashcardMode ?? "add_order",
                                ) === 3
                                  ? "text-green-500"
                                  : "text-muted-foreground"
                              }
                            />
                          ),
                        )}
                        <Pressable
                          onPress={() => router.push(`/lists/word/${currentItem.entry.id}`)}
                          hitSlop={8}
                        >
                          <Info size={18} className="text-muted-foreground" />
                        </Pressable>
                      </View>
                    )}
                    {isFocused && isFlipping ? (
                      <>
                        <Animated.View
                          style={[
                            frontFaceStyle,
                            {
                              flex: 1,
                              width: "100%",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          ]}
                        >
                          {renderCardFront(card.item, card.isCurrent)}
                        </Animated.View>
                        <Animated.View
                          style={[
                            backFaceStyle,
                            { alignItems: "center", justifyContent: "center", padding: 16 },
                          ]}
                        >
                          {renderCardRevealed(card.item)}
                        </Animated.View>
                      </>
                    ) : card.isRevealed ? (
                      renderCardRevealed(card.item)
                    ) : (
                      renderCardFront(card.item, card.isCurrent)
                    )}
                  </Card>
                </View>
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Desktop navigation buttons */}
      {Platform.OS === "web" && (
        <View className="flex-row justify-center items-center gap-4 mt-2">
          <Pressable
            onPress={goBackAnimated}
            disabled={!hasPrev}
            style={{ opacity: hasPrev ? 1 : 0.3 }}
            className="p-2"
          >
            <ChevronLeft size={24} className="text-foreground" />
          </Pressable>
          <Pressable
            onPress={goForwardAnimated}
            disabled={!hasNext}
            style={{ opacity: hasNext ? 1 : 0.3 }}
            className="p-2"
          >
            <ChevronRight size={24} className="text-foreground" />
          </Pressable>
        </View>
      )}

      {/* Rating buttons */}
      {(revealed || isBrowsingHistory) && (
        <View className="flex-row gap-3 px-4 mt-4 mb-8">
          <Button className="flex-1 bg-red-500" label="Fail" onPress={handleFail} />
          <Pressable
            onPressIn={handlePassPressIn}
            onPressOut={handlePassPressOut}
            className={`flex-1 items-center justify-center rounded-lg h-11 ${longPressActive ? "bg-blue-500" : "bg-green-500"}`}
          >
            <Text className="font-medium text-white">{longPressActive ? "Easy!" : "Pass"}</Text>
          </Pressable>
        </View>
      )}

      {/* Web/Android action sheet menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setMenuVisible(false)}>
          <View className="mx-4 mb-8 rounded-2xl border border-border bg-background overflow-hidden">
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                setSettingsVisible(true);
              }}
              className="items-center py-4 border-b border-border"
            >
              <Text className="text-base text-foreground">Options</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                setStatsVisible(true);
              }}
              className="items-center py-4 border-b border-border"
            >
              <Text className="text-base text-foreground">Statistics</Text>
            </Pressable>
            <Pressable onPress={() => setMenuVisible(false)} className="items-center py-4">
              <Text className="text-base text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Confused words modal */}
      <Modal
        visible={confusedWordsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfusedWordsVisible(false)}
      >
        <View className="flex-1">
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            className="bg-black/50"
            onPress={() => setConfusedWordsVisible(false)}
          />
          <View className="flex-1 justify-center px-6">
            <View className="rounded-2xl border border-border bg-background p-5">
              <Text className="text-lg font-semibold text-foreground mb-1">
                Similar words in your list
              </Text>
              <Text className="text-sm text-muted-foreground mb-4">
                You might be confusing these words
              </Text>

              {confusedFailedEntry &&
                confusedResults.map((result, ri) => {
                  const failedKanji = confusedFailedEntry.kanji[0]?.text ?? "";
                  const confusedKanji = result.entry.kanji[0]?.text ?? "";
                  const matchPositions = new Set(result.matches.map((m) => m.position));

                  return (
                    <View key={ri} className="mb-4">
                      {/* Side-by-side comparison */}
                      <View className="flex-row items-center justify-center gap-4 mb-2">
                        {/* Failed word */}
                        <View className="items-center flex-1">
                          <View className="flex-row">
                            {[...failedKanji].map((ch, ci) => (
                              <Text
                                key={ci}
                                className={`text-2xl font-bold ${matchPositions.has(ci) ? "text-red-500" : "text-foreground"}`}
                              >
                                {ch}
                              </Text>
                            ))}
                          </View>
                          <Text className="text-xs text-muted-foreground mt-1">
                            {confusedFailedEntry.kana[0]?.text ?? ""}
                          </Text>
                          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                            {getFaceText(confusedFailedEntry, "english")}
                          </Text>
                        </View>

                        <Text className="text-muted-foreground">vs</Text>

                        {/* Confused word */}
                        <View className="items-center flex-1">
                          <View className="flex-row">
                            {[...confusedKanji].map((ch, ci) => (
                              <Text
                                key={ci}
                                className={`text-2xl font-bold ${matchPositions.has(ci) ? "text-orange-500" : "text-foreground"}`}
                              >
                                {ch}
                              </Text>
                            ))}
                          </View>
                          <Text className="text-xs text-muted-foreground mt-1">
                            {(result.entry as DictEntry).kana?.[0]?.text ?? ""}
                          </Text>
                          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                            {getFaceText(result.entry as DictEntry, "english")}
                          </Text>
                        </View>
                      </View>

                      {/* Match details */}
                      <View className="flex-row flex-wrap justify-center gap-2 mb-2">
                        {result.matches.map((m, mi) => (
                          <View
                            key={mi}
                            className="flex-row items-center bg-muted rounded px-2 py-1"
                          >
                            <Text className="text-sm text-red-500 font-bold">{m.failedKanji}</Text>
                            <Text className="text-xs text-muted-foreground mx-1">≈</Text>
                            <Text className="text-sm text-orange-500 font-bold">
                              {m.candidateKanji}
                            </Text>
                            <Text className="text-xs text-muted-foreground ml-1">
                              {Math.round(m.similarity * 100)}%
                            </Text>
                          </View>
                        ))}
                      </View>

                      <Button
                        variant="outline"
                        label="Add to review"
                        onPress={() => {
                          handleAddConfusedToReview(result);
                          setConfusedResults((prev) => prev.filter((_, i) => i !== ri));
                          if (confusedResults.length <= 1) setConfusedWordsVisible(false);
                        }}
                      />
                    </View>
                  );
                })}

              <Button
                className="mt-1"
                variant="outline"
                label="Dismiss"
                onPress={() => setConfusedWordsVisible(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      <FlashcardSettingsModal
        visible={settingsVisible}
        onClose={() => {
          setSettingsVisible(false);
          loadQueue();
        }}
        listId={listId!}
      />

      <StudyStatisticsModal
        visible={statsVisible}
        onClose={() => setStatsVisible(false)}
        listId={listId!}
        flashcardMode={list?.flashcardMode ?? "add_order"}
        onClearStatistics={loadQueue}
      />
    </View>
  );
}
