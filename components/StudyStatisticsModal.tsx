import React, { useEffect, useState } from "react";
import { Modal, Pressable, View, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
import { midoriDaysToDate } from "@/stores/simple-srs";
import { confirm } from "@/lib/confirm";
import type { FlashcardMode } from "@/db/types";

interface StudyStatisticsModalProps {
  visible: boolean;
  onClose: () => void;
  listId: string;
  flashcardMode: FlashcardMode;
  onClearStatistics: () => void;
}

interface DayBucket {
  label: string;
  count: number;
}

function getDayLabels(): string[] {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const labels = ["Today", "Tomorrow"];
  const now = new Date();
  for (let i = 2; i <= 6; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    labels.push(days[d.getDay()]);
  }
  // 7+ days bucket: use the day name with "+"
  const d7 = new Date(now);
  d7.setDate(d7.getDate() + 7);
  labels.push(days[d7.getDay()] + "+");
  return labels;
}

function dateToBucketIndex(date: Date): number {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((date.getTime() - todayStart.getTime()) / (24 * 3600 * 1000));
  if (diff <= 0) return 0; // overdue or today
  if (diff === 1) return 1; // tomorrow
  if (diff <= 6) return diff; // 2-6 days out
  return 7; // 7+ days
}

export function StudyStatisticsModal({
  visible,
  onClose,
  listId,
  flashcardMode,
  onClearStatistics,
}: StudyStatisticsModalProps) {
  const userDb = useUserDb();
  const updateList = useListsStore((s) => s.updateList);
  const [buckets, setBuckets] = useState<DayBucket[]>([]);
  const [addOrderStats, setAddOrderStats] = useState<{
    total: number;
    studied: number;
    remaining: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    if (!userDb) return;
    setLoading(true);

    if (flashcardMode === "add_order") {
      const totalRow = await userDb.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM list_entries WHERE list_id = ?",
        [listId],
      );
      const list = useListsStore.getState().lists.find((l) => l.id === listId);
      const position = list?.studyPosition ?? 0;
      const total = totalRow?.c ?? 0;
      setAddOrderStats({
        total,
        studied: Math.min(position, total),
        remaining: Math.max(total - position, 0),
      });
      setBuckets([]);
      setLoading(false);
      return;
    }

    const labels = getDayLabels();
    const counts = new Array(8).fill(0);

    if (flashcardMode === "simple_srs") {
      const rows = await userDb.getAllAsync<{
        dueDays: number;
      }>(
        `SELECT (simple_n + simple_interval) as dueDays
         FROM srs_cards WHERE list_id = ? AND simple_stage IS NOT NULL`,
        [listId],
      );
      for (const row of rows) {
        const dueDate = midoriDaysToDate(row.dueDays);
        const idx = dateToBucketIndex(dueDate);
        counts[idx]++;
      }
    } else {
      // FSRS mode
      // Count new cards (state=0) under Today
      const newRow = await userDb.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND state = 0",
        [listId],
      );
      counts[0] += newRow?.c ?? 0;

      // Count review cards by due date
      const rows = await userDb.getAllAsync<{ due: string }>(
        "SELECT due FROM srs_cards WHERE list_id = ? AND state != 0",
        [listId],
      );
      for (const row of rows) {
        const dueDate = new Date(row.due);
        const idx = dateToBucketIndex(dueDate);
        counts[idx]++;
      }
    }

    setBuckets(labels.map((label, i) => ({ label, count: counts[i] })));
    setAddOrderStats(null);
    setLoading(false);
  };

  useEffect(() => {
    if (visible && userDb) loadStats();
  }, [visible, userDb]);

  async function handleClear() {
    const ok = await confirm(
      "Clear Statistics",
      "This will reset all study progress for this list. This cannot be undone.",
    );
    if (!ok) return;
    if (!userDb) return;

    if (flashcardMode === "simple_srs") {
      await userDb.runAsync(
        "UPDATE srs_cards SET simple_stage = NULL, simple_n = NULL, simple_interval = NULL WHERE list_id = ?",
        [listId],
      );
    } else if (flashcardMode === "srs") {
      // Reset FSRS fields to new state
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
      // Delete review logs for this list's cards
      await userDb.runAsync(
        `DELETE FROM review_logs WHERE card_id IN (
          SELECT id FROM srs_cards WHERE list_id = ?
        )`,
        [listId],
      );
    } else {
      // add_order: reset study position
      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE lists SET study_position = 0, updated_at = ? WHERE id = ?", [
        now,
        listId,
      ]);
      updateList(listId, { studyPosition: 0, updatedAt: now });
    }

    onClearStatistics();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View className="rounded-2xl border border-border bg-background p-5">
            <Text className="text-lg font-semibold text-foreground mb-4">Statistics</Text>

            {loading ? (
              <ActivityIndicator className="py-4" />
            ) : addOrderStats ? (
              <View className="mb-4">
                <Text className="text-xs font-semibold text-muted-foreground tracking-wider mb-2">
                  PROGRESS
                </Text>
                <StatRow label="Total" count={addOrderStats.total} />
                <StatRow label="Studied" count={addOrderStats.studied} />
                <StatRow label="Remaining" count={addOrderStats.remaining} />
              </View>
            ) : (
              <View className="mb-4">
                <Text className="text-xs font-semibold text-muted-foreground tracking-wider mb-2">
                  DUE CARDS
                </Text>
                {buckets.map((b) => (
                  <StatRow key={b.label} label={b.label} count={b.count} />
                ))}
              </View>
            )}

            <View className="flex-row gap-2">
              <Button className="flex-1" variant="outline" label="Close" onPress={onClose} />
              <Pressable
                onPress={handleClear}
                className="flex-1 items-center justify-center rounded-lg border border-red-500 py-2"
              >
                <Text className="text-sm font-medium text-red-500">Clear Statistics</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StatRow({ label, count }: { label: string; count: number }) {
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-border">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-row items-center gap-1">
        {count > 0 && <Text className="text-sm text-muted-foreground">{count}</Text>}
        <ChevronRight size={14} className="text-muted-foreground" />
      </View>
    </View>
  );
}
