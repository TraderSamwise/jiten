import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { ChevronRight } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useSync } from "@/db/sync-provider";
import { useListsStore } from "@/stores/lists";
import { srsEpochDaysToDate, endOfLogicalDayEpochDays } from "@/stores/simple-srs";
import { useAtomValue } from "jotai";
import { dayResetHourAtom } from "@/stores/settings";
import type { FlashcardMode } from "@/db/types";

interface DueCardsSectionProps {
  listId: string;
  flashcardMode: FlashcardMode;
  showHeader?: boolean;
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
  const d7 = new Date(now);
  d7.setDate(d7.getDate() + 7);
  labels.push(days[d7.getDay()] + "+");
  return labels;
}

function dateToBucketIndex(date: Date, resetHour: number): number {
  // Use logical day boundary: today ends at resetHour tomorrow
  const now = new Date();
  const logicalDayStart = new Date(now);
  if (now.getHours() < resetHour) {
    logicalDayStart.setDate(logicalDayStart.getDate() - 1);
  }
  logicalDayStart.setHours(resetHour, 0, 0, 0);
  const diff = Math.floor((date.getTime() - logicalDayStart.getTime()) / (24 * 3600 * 1000));
  if (diff <= 0) return 0; // due today (before next reset)
  if (diff === 1) return 1;
  if (diff <= 6) return diff;
  return 7;
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

export function DueCardsSection({
  listId,
  flashcardMode,
  showHeader = true,
}: DueCardsSectionProps) {
  const userDb = useUserDb();
  const { lastSyncAt } = useSync();
  const dayResetHour = useAtomValue(dayResetHourAtom);
  const [buckets, setBuckets] = useState<DayBucket[]>([]);
  const [addOrderStats, setAddOrderStats] = useState<{
    total: number;
    studied: number;
    remaining: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userDb) loadStats();
  }, [userDb, listId, flashcardMode, lastSyncAt, dayResetHour]);

  async function loadStats() {
    if (!userDb) return;
    setLoading(true);

    if (flashcardMode === "add_order") {
      const totalRow = await userDb.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM list_entries WHERE list_id = ? AND deleted_at IS NULL",
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
      const rows = await userDb.getAllAsync<{ dueDays: number }>(
        `SELECT simple_n as dueDays
         FROM srs_cards WHERE list_id = ? AND simple_stage IS NOT NULL AND deleted_at IS NULL`,
        [listId],
      );
      for (const row of rows) {
        const dueDate = srsEpochDaysToDate(row.dueDays);
        const idx = dateToBucketIndex(dueDate, dayResetHour);
        counts[idx]++;
      }
    } else {
      const newRow = await userDb.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND state = 0 AND deleted_at IS NULL",
        [listId],
      );
      counts[0] += newRow?.c ?? 0;

      const rows = await userDb.getAllAsync<{ due: string }>(
        "SELECT due FROM srs_cards WHERE list_id = ? AND state != 0 AND deleted_at IS NULL",
        [listId],
      );
      for (const row of rows) {
        const dueDate = new Date(row.due);
        const idx = dateToBucketIndex(dueDate, dayResetHour);
        counts[idx]++;
      }
    }

    setBuckets(labels.map((label, i) => ({ label, count: counts[i] })));
    setAddOrderStats(null);
    setLoading(false);
  }

  if (loading) return <ActivityIndicator className="py-4" />;

  if (addOrderStats) {
    return (
      <View>
        {showHeader && (
          <Text className="text-xs font-semibold text-muted-foreground tracking-wider mb-2">
            PROGRESS
          </Text>
        )}
        <StatRow label="Total" count={addOrderStats.total} />
        <StatRow label="Studied" count={addOrderStats.studied} />
        <StatRow label="Remaining" count={addOrderStats.remaining} />
      </View>
    );
  }

  return (
    <View>
      {showHeader && (
        <Text className="text-xs font-semibold text-muted-foreground tracking-wider mb-2">
          DUE CARDS
        </Text>
      )}
      {buckets.map((b) => (
        <StatRow key={b.label} label={b.label} count={b.count} />
      ))}
    </View>
  );
}
