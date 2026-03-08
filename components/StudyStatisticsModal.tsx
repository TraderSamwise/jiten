import React from "react";
import { Modal, Pressable, Platform, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { DueCardsSection } from "@/components/DueCardsSection";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
import { confirm } from "@/lib/confirm";
import { useSync } from "@/db/sync-provider";
import type { FlashcardMode } from "@/db/types";

interface StudyStatisticsModalProps {
  visible: boolean;
  onClose: () => void;
  listId: string;
  flashcardMode: FlashcardMode;
  onClearStatistics: () => void;
}

export function StudyStatisticsModal({
  visible,
  onClose,
  listId,
  flashcardMode,
  onClearStatistics,
}: StudyStatisticsModalProps) {
  const userDb = useUserDb();
  const { markDirty } = useSync();
  const updateList = useListsStore((s) => s.updateList);

  async function handleClear() {
    const ok = await confirm(
      "Clear All",
      "This will reset all review and SRS data for this list. This cannot be undone.",
    );
    if (!ok) return;
    if (!userDb) return;

    if (flashcardMode === "simple_srs") {
      const now = new Date().toISOString();
      await userDb.runAsync(
        "UPDATE srs_cards SET simple_stage = NULL, simple_n = NULL, simple_interval = NULL, updated_at = ? WHERE list_id = ?",
        [now, listId],
      );
    } else if (flashcardMode === "srs") {
      const now = new Date().toISOString();
      await userDb.runAsync(
        `UPDATE srs_cards SET
          due = ?, stability = 0, difficulty = 0,
          elapsed_days = 0, scheduled_days = 0,
          reps = 0, lapses = 0, state = 0,
          last_review = NULL, updated_at = ?
         WHERE list_id = ?`,
        [now, now, listId],
      );
      await userDb.runAsync(
        `DELETE FROM review_logs WHERE card_id IN (
          SELECT id FROM srs_cards WHERE list_id = ?
        )`,
        [listId],
      );
    } else {
      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE lists SET study_position = 0, updated_at = ? WHERE id = ?", [
        now,
        listId,
      ]);
      updateList(listId, { studyPosition: 0, updatedAt: now });
    }

    markDirty();
    onClearStatistics();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View
            className="rounded-2xl border border-border bg-background p-5"
            style={
              Platform.OS === "web"
                ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Text className="text-lg font-semibold text-foreground mb-4">Due Cards</Text>

            <View className="mb-4">
              {visible && (
                <DueCardsSection listId={listId} flashcardMode={flashcardMode} showHeader={false} />
              )}
            </View>

            <View className="flex-row gap-2">
              <Button className="flex-1" variant="outline" label="Close" onPress={onClose} />
              <Pressable
                onPress={handleClear}
                className="flex-1 items-center justify-center rounded-lg border border-red-500 py-2"
              >
                <Text className="text-sm font-medium text-red-500">Clear All</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
