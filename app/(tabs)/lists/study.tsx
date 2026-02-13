import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Pressable,
  ActionSheetIOS,
  Platform,
  Modal,
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
import { X, Settings, EllipsisVertical, Info, Check, ChevronLeft, ChevronRight } from "@/lib/icons";
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
import type { DictEntry, CardFace, SrsCardRow, FlashcardMode } from "@/db/types";
import type { Card as FsrsCard } from "ts-fsrs";

const NEW_CARD_BATCH_SIZE = 5;
const CARD_PEEK = 40;
const CARD_GAP = 8;
const SWIPE_THRESHOLD = 80;
const SLIDE_DURATION = 250;
const FLIP_DURATION = 400;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
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
  // Simple SRS progress: learned/total (only increments on new cards)
  const [simpleSrsLearned, setSimpleSrsLearned] = useState(0);
  const [simpleSrsTotal, setSimpleSrsTotal] = useState(0);

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
          simple_interval as simpleInterval`;

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
          simple_interval as simpleInterval`;

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

    // Push failed card to end of queue for re-review
    const failedItem = queue[currentIndex];
    const newQueue = [...queue, failedItem];
    setQueue(newQueue);
    advance(newQueue);
  }

  async function handlePass(isLongPress: boolean) {
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
      `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?, updated_at = ? WHERE id = ?`,
      [updates.simpleStage, updates.simpleN, updates.simpleInterval, now, card.id],
    );

    if (isNew) {
      setSimpleSrsLearned((c) => c + 1);
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
        `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?, updated_at = ? WHERE id = ?`,
        [snap.simpleStage, snap.simpleN, snap.simpleInterval, now, card.id],
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
          options: ["Options", "Cancel"],
          cancelButtonIndex: 1,
        },
        (index) => {
          if (index === 0) setSettingsVisible(true);
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
    const cards: Array<{ item: QueueItem; isRevealed: boolean }> = [];
    history.forEach((h) => {
      cards.push({ item: h.queueItem, isRevealed: true });
    });
    if (!sessionDone && queue[currentIndex]) {
      cards.push({ item: queue[currentIndex], isRevealed: revealed });
    }
    // Pre-render next card so advance animation has something to slide to
    if (!sessionDone && currentIndex + 1 < queue.length) {
      cards.push({ item: queue[currentIndex + 1], isRevealed: false });
    }
    return cards;
  }, [history, queue, currentIndex, revealed, sessionDone]);

  const focusedCardIndex = isBrowsingHistory ? historyIndex! : history.length;
  const hasPrev = focusedCardIndex > 0;
  const hasNext = focusedCardIndex < history.length; // can only navigate forward within history

  // --- Handle reveal with flip ---
  function handleReveal() {
    if (revealed) return;
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

  function renderCardFront(item: QueueItem) {
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
        <Text className="mt-6 text-sm text-muted-foreground">Tap to reveal</Text>
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
        <View className="flex-row items-center">
          <Pressable onPress={() => setStatsVisible(true)} className="p-2">
            <EllipsisVertical size={20} className="text-foreground" />
          </Pressable>
          <Pressable onPress={handleGear} className="p-2">
            <Settings size={20} className="text-foreground" />
          </Pressable>
        </View>
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
                          {renderCardFront(card.item)}
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
                      renderCardFront(card.item)
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
            <Pressable onPress={() => setMenuVisible(false)} className="items-center py-4">
              <Text className="text-base text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
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
