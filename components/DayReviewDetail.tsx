import React from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Check, X, ChevronLeft, ChevronRight } from "@/lib/icons";
import { EntrySummary } from "@/components/EntrySummary";
import { ConfusionClusters } from "@/components/ConfusionClusters";
import {
  practiceModeLabel,
  type DaySessionDetail,
  type DayEntryResult,
  type ConfusionCluster,
} from "@/lib/practice-stats";
import type { DictEntry } from "@/db/types";

interface DayReviewDetailProps {
  day: string;
  sessions: DaySessionDetail[];
  entries: Map<number, DictEntry>;
  loading: boolean;
  onNavigateDay: (day: string) => void;
  onClose: () => void;
  onPressEntry: (entryId: number) => void;
  onPressKanji: (literal: string) => void;
  confusionClusters?: ConfusionCluster[];
}

function formatDayHeader(day: string): string {
  const date = new Date(day + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainMin = minutes % 60;
    return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function DayReviewDetail({
  day,
  sessions,
  entries,
  loading,
  onNavigateDay,
  onClose,
  onPressEntry,
  onPressKanji,
  confusionClusters,
}: DayReviewDetailProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const isToday = day === todayStr;

  function navigatePrev() {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onNavigateDay(d.toISOString().slice(0, 10));
  }

  function navigateNext() {
    if (isToday) return;
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + 1);
    onNavigateDay(d.toISOString().slice(0, 10));
  }

  const totalReviews = sessions.reduce((sum, s) => sum + s.totalItems, 0);
  const totalCorrect = sessions.reduce((sum, s) => sum + s.correctCount, 0);
  const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;
  const totalDuration = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

  return (
    <View>
      {/* Day navigation header */}
      <View className="flex-row items-center justify-between mb-2">
        <Pressable onPress={navigatePrev} className="p-1" hitSlop={8}>
          <ChevronLeft size={20} className="text-foreground" />
        </Pressable>
        <Pressable onPress={onClose}>
          <Text className="text-base font-semibold text-foreground">{formatDayHeader(day)}</Text>
        </Pressable>
        <Pressable onPress={navigateNext} className="p-1" hitSlop={8} disabled={isToday}>
          <ChevronRight size={20} className={isToday ? "text-muted" : "text-foreground"} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator className="py-4" />
      ) : sessions.length === 0 ? (
        <Text className="text-sm text-muted-foreground text-center py-4">
          No reviews on this day
        </Text>
      ) : (
        <>
          {/* Day summary */}
          <Text className="text-xs text-muted-foreground text-center mb-3">
            {totalReviews} review{totalReviews !== 1 ? "s" : ""} · {accuracy}%
            {totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ""}
          </Text>

          {/* Sessions */}
          <View className="gap-3">
            {sessions.map((session, idx) => {
              const sessAccuracy =
                session.totalItems > 0
                  ? Math.round((session.correctCount / session.totalItems) * 100)
                  : 0;
              return (
                <View key={session.sessionId ?? `ungrouped-${idx}`}>
                  {/* Session header */}
                  <View className="flex-row items-center gap-2 mb-1">
                    <View className="bg-muted px-2 py-0.5 rounded">
                      <Text className="text-xs text-foreground">
                        {practiceModeLabel(session.practiceMode)}
                      </Text>
                    </View>
                    {session.startedAt && (
                      <Text className="text-xs text-muted-foreground">
                        {formatTime(session.startedAt)}
                      </Text>
                    )}
                    <Text className="text-xs text-muted-foreground flex-1 text-right">
                      {session.correctCount}/{session.totalItems} ({sessAccuracy}%)
                    </Text>
                  </View>

                  {/* Entry rows */}
                  <View className="gap-0.5">
                    {session.entries.map((entry) => (
                      <EntryRow
                        key={`${entry.entryId}-${entry.kanjiLiteral}`}
                        result={entry}
                        dictEntry={
                          entry.kanjiLiteral == null ? entries.get(entry.entryId) : undefined
                        }
                        onPress={() => {
                          if (entry.kanjiLiteral) onPressKanji(entry.kanjiLiteral);
                          else onPressEntry(entry.entryId);
                        }}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Mix-ups section */}
          {confusionClusters && confusionClusters.length > 0 && (
            <View className="mt-3 pt-3 border-t border-border">
              <Text className="text-xs font-semibold text-muted-foreground mb-2">Mix-ups</Text>
              <ConfusionClusters
                clusters={confusionClusters}
                entries={entries}
                onPressEntry={onPressEntry}
                onPressKanji={onPressKanji}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

function EntryRow({
  result,
  dictEntry,
  onPress,
}: {
  result: DayEntryResult;
  dictEntry?: DictEntry;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-2 py-1.5 px-1">
      {result.correct && !result.assisted ? (
        <Check size={14} className="text-green-500" />
      ) : result.correct && result.assisted ? (
        <Check size={14} className="text-yellow-500" />
      ) : (
        <X size={14} className="text-red-500" />
      )}
      <View className="flex-1">
        {result.kanjiLiteral ? (
          <Text className="text-base text-foreground">{result.kanjiLiteral}</Text>
        ) : dictEntry ? (
          <EntrySummary entry={dictEntry} variant="compact" />
        ) : (
          <Text className="text-sm text-muted-foreground">#{result.entryId}</Text>
        )}
        {!result.correct && result.lastTypedAnswer && (
          <Text className="text-xs text-red-400 ml-5">typed: {result.lastTypedAnswer}</Text>
        )}
      </View>
      {result.avgResponseMs != null && (
        <Text className="text-xs text-muted-foreground">
          {(result.avgResponseMs / 1000).toFixed(1)}s
        </Text>
      )}
    </Pressable>
  );
}
