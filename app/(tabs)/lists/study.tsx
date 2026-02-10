import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, ActionSheetIOS, Platform, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { X, Settings } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntries } from "@/db/search";
import { reviewCard, Rating } from "@/stores/srs";
import { useListsStore } from "@/stores/lists";
import type { DictEntry, CardFace, SrsCardRow } from "@/db/types";
import type { Card as FsrsCard } from "ts-fsrs";

const NEW_CARD_BATCH_SIZE = 5;

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

export default function StudyScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dictDb } = useDatabase();
  const userDb = useUserDb();
  const list = useListsStore((s) => s.lists.find((l) => l.id === listId));
  const updateList = useListsStore((s) => s.updateList);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionDone, setSessionDone] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);

  useEffect(() => {
    if (dictDb && userDb && list) loadQueue();
  }, [dictDb, userDb, list?.id]);

  async function loadQueue() {
    if (!dictDb || !userDb || !list || !listId) return;
    setLoading(true);

    if (list.flashcardMode === "add_order") {
      let position = list.studyPosition ?? 0;
      let rows = await userDb.getAllAsync<{ entry_id: number }>(
        "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at ASC LIMIT 10 OFFSET ?",
        [listId, position],
      );

      // Wrap around to start if we've passed the end
      if (rows.length === 0 && position > 0) {
        position = 0;
        await userDb.runAsync("UPDATE lists SET study_position = 0, updated_at = ? WHERE id = ?", [
          new Date().toISOString(),
          listId,
        ]);
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
    } else {
      // SRS mode: reviews first, then a batch of new cards
      const srsSelect = `SELECT id, entry_id as entryId, list_id as listId, due,
          stability, difficulty, elapsed_days as elapsedDays,
          scheduled_days as scheduledDays, reps, lapses, state,
          last_review as lastReview, front_mode as frontMode,
          back_mode as backMode, created_at as createdAt,
          updated_at as updatedAt`;

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

    setLoading(false);
  }

  async function handleFail() {
    if (currentIndex >= queue.length) return;

    if (list?.flashcardMode === "srs" && queue[currentIndex].srsCard) {
      await rateSrsCard(queue[currentIndex].srsCard!, Rating.Again);
    }

    // Push failed card to end of queue for re-review
    const failedItem = queue[currentIndex];
    const newQueue = [...queue, failedItem];
    setQueue(newQueue);
    advance(newQueue);
  }

  async function handlePass(isLongPress: boolean) {
    if (currentIndex >= queue.length) return;

    if (list?.flashcardMode === "add_order") {
      // Increment study_position
      if (!userDb || !listId) return;
      await userDb.runAsync(
        "UPDATE lists SET study_position = study_position + 1, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), listId],
      );
      const currentList = useListsStore.getState().lists.find((l) => l.id === listId);
      if (currentList) {
        updateList(listId, {
          studyPosition: (currentList.studyPosition ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (queue[currentIndex].srsCard) {
      const rating = isLongPress ? Rating.Easy : Rating.Good;
      await rateSrsCard(queue[currentIndex].srsCard!, rating);
    }

    setReviewedCount((c) => c + 1);
    advance(queue);
  }

  async function rateSrsCard(card: SrsCardRow, rating: Rating) {
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
        generateId(),
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

  function advance(currentQueue: QueueItem[]) {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= currentQueue.length) {
      // Both modes: reload queue for next batch
      // SRS: picks up learning cards that became due + next batch of new cards
      // add_order: wraps around at end
      loadQueue();
    } else {
      setCurrentIndex(nextIndex);
      setRevealed(false);
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

  const currentItem = queue[currentIndex];
  const frontFaces = list?.frontFaces ?? ["kanji"];
  const backFaces = list?.backFaces ?? ["english"];
  const total = queue.length;
  const progress = total > 0 ? (currentIndex / total) * 100 : 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2">
          <X size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-sm text-muted-foreground">
          {currentIndex + 1} / {total}
        </Text>
        <Pressable onPress={handleGear} className="p-2">
          <Settings size={20} className="text-foreground" />
        </Pressable>
      </View>

      {/* Progress bar */}
      <View className="h-1 bg-border mx-4 rounded-full overflow-hidden">
        <View className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
      </View>

      {/* Card */}
      <Pressable onPress={() => !revealed && setRevealed(true)} className="flex-1 px-4 pt-4">
        <Card className="flex-1 items-center justify-center max-h-96">
          {currentItem && (
            <>
              {/* Front face */}
              <View className="items-center">
                <Text className="text-3xl font-bold text-foreground">
                  {getFaceText(currentItem.entry, frontFaces[0])}
                </Text>
                {frontFaces.slice(1).map((face, i) => (
                  <Text key={`front-${i}`} className="mt-1 text-lg text-muted-foreground">
                    {getFaceText(currentItem.entry, face)}
                  </Text>
                ))}
              </View>

              {/* Back face (revealed) */}
              {revealed && (
                <View className="mt-6 items-center">
                  <View className="h-px w-32 bg-border mb-4" />
                  <Text className="text-xl text-foreground">
                    {getFaceText(currentItem.entry, backFaces[0])}
                  </Text>
                  {backFaces.slice(1).map((face, i) => (
                    <Text key={`back-${i}`} className="mt-1 text-base text-muted-foreground">
                      {getFaceText(currentItem.entry, face)}
                    </Text>
                  ))}
                </View>
              )}

              {!revealed && (
                <Text className="mt-6 text-sm text-muted-foreground">Tap to reveal</Text>
              )}
            </>
          )}
        </Card>
      </Pressable>

      {/* Rating buttons */}
      {revealed && (
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
    </View>
  );
}
