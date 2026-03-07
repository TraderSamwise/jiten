import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { ChevronLeft } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getEntries } from "@/db/search";
import { useListsStore } from "@/stores/lists";
import { useTabRouter, useSafeGoBack } from "@/lib/navigation";
import { CustomHeaderScreen, useWebBackdrop } from "@/components/CustomHeaderScreen";
import { Heatmap } from "@/components/charts/Heatmap";
import { WeeklyBarChart } from "@/components/charts/WeeklyBarChart";
import { DayReviewDetail } from "@/components/DayReviewDetail";
import { ConfusionClusters } from "@/components/ConfusionClusters";
import { DueCardsSection } from "@/components/DueCardsSection";
import {
  getDailyActivity,
  getRecentSessions,
  getTopConfusionPairs,
  getCardStateDistribution,
  getTodaySummary,
  getCurrentStreak,
  getLeechCards,
  getDaySessionsWithEvents,
  buildConfusionClusters,
  buildDayConfusionClusters,
  type DailyActivity,
  type SessionSummary,
  type CardDistribution,
  type TodaySummary,
  type StreakInfo,
  type LeechCard,
  type DaySessionDetail,
  type ConfusionCluster,
} from "@/lib/practice-stats";
import type { DictEntry } from "@/db/types";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const remainMin = minutes % 60;
    return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function practiceModeLabel(mode: string): string {
  switch (mode) {
    case "typing_game":
      return "Typing";
    case "flashcard":
      return "Flashcard";
    case "typing_flashcard":
      return "Type Flash";
    case "voice":
      return "Voice";
    default:
      return mode;
  }
}

export default function StatsScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const tabRouter = useTabRouter();
  const goBack = useSafeGoBack("/lists");
  const { webBgStyle, insets } = useWebBackdrop();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const list = useListsStore((s) => s.lists.find((l) => l.id === listId));

  const [scope, setScope] = useState<"list" | "all">(listId ? "list" : "all");
  const [loading, setLoading] = useState(true);

  // Data
  const [todaySummary, setTodaySummary] = useState<TodaySummary | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cardDist, setCardDist] = useState<CardDistribution | null>(null);
  const [leeches, setLeeches] = useState<LeechCard[]>([]);
  const [clusters, setClusters] = useState<ConfusionCluster[]>([]);
  const [todayClusters, setTodayClusters] = useState<ConfusionCluster[]>([]);
  const [entryMap, setEntryMap] = useState<Map<number, DictEntry>>(new Map());

  // Day drill-down
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DaySessionDetail[]>([]);
  const [dayEntries, setDayEntries] = useState<Map<number, DictEntry>>(new Map());
  const [dayClusters, setDayClusters] = useState<ConfusionCluster[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const effectiveListId = scope === "list" ? listId : undefined;
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    loadAllData();
  }, [userDb, dictDb, scope, listId]);

  useEffect(() => {
    if (selectedDay) loadDayDetail(selectedDay);
  }, [selectedDay, effectiveListId]);

  async function loadAllData() {
    if (!userDb) return;
    setLoading(true);

    const lid = scope === "list" ? listId : undefined;

    const [todayData, streakData, activityData, sessionData, confusionData, todayConfClusters] =
      await Promise.all([
        getTodaySummary(userDb, lid),
        getCurrentStreak(userDb, lid),
        getDailyActivity(userDb, lid, 90),
        getRecentSessions(userDb, lid, 15),
        getTopConfusionPairs(userDb, lid, 20),
        buildDayConfusionClusters(userDb, todayStr, lid),
      ]);

    setTodaySummary(todayData);
    setStreak(streakData);
    setDailyActivity(activityData);
    setSessions(sessionData);
    setTodayClusters(todayConfClusters);

    // Build confusion clusters
    setClusters(buildConfusionClusters(confusionData));

    // Card distribution + leeches only for per-list scope
    if (lid) {
      const dist = await getCardStateDistribution(userDb, lid);
      setCardDist(dist);
      const leechData = await getLeechCards(userDb, lid, 8, 0.6);
      setLeeches(leechData.slice(0, 10));
    } else {
      setCardDist(null);
      setLeeches([]);
    }

    // Resolve entry names for leeches, confusion clusters, and today's mix-ups
    if (dictDb) {
      const entryIds = new Set<number>();
      if (lid) {
        const leechData = await getLeechCards(userDb, lid, 8, 0.6);
        for (const l of leechData.slice(0, 10)) {
          if (l.kanjiLiteral == null) entryIds.add(l.entryId);
        }
      }
      for (const cp of confusionData) {
        entryIds.add(cp.entryIdA);
        entryIds.add(cp.entryIdB);
      }
      for (const cluster of todayConfClusters) {
        for (const e of cluster.entries) {
          if (e.kanjiLiteral == null) entryIds.add(e.entryId);
        }
      }
      if (entryIds.size > 0) {
        const entries = await getEntries(dictDb, [...entryIds]);
        setEntryMap(new Map(entries.map((e) => [e.id, e])));
      }
    }

    setLoading(false);
  }

  async function loadDayDetail(day: string) {
    if (!userDb) return;
    setDayLoading(true);

    const [sessions, dayConfClusters] = await Promise.all([
      getDaySessionsWithEvents(userDb, day, effectiveListId),
      buildDayConfusionClusters(userDb, day, effectiveListId),
    ]);
    setDayDetail(sessions);
    setDayClusters(dayConfClusters);

    // Resolve word entries for display
    if (dictDb) {
      const ids = new Set<number>();
      for (const s of sessions) {
        for (const e of s.entries) {
          if (e.kanjiLiteral == null) ids.add(e.entryId);
        }
      }
      for (const cluster of dayConfClusters) {
        for (const e of cluster.entries) {
          if (e.kanjiLiteral == null) ids.add(e.entryId);
        }
      }
      if (ids.size > 0) {
        const entries = await getEntries(dictDb, [...ids]);
        setDayEntries(new Map(entries.map((e) => [e.id, e])));
      } else {
        setDayEntries(new Map());
      }
    }

    setDayLoading(false);
  }

  function getEntryDisplay(entryId: number, kanjiLiteral: string | null): string {
    if (kanjiLiteral) return kanjiLiteral;
    const entry = entryMap.get(entryId);
    if (entry) {
      return entry.kanji[0]?.text || entry.kana[0]?.text || `#${entryId}`;
    }
    return `#${entryId}`;
  }

  function handlePressEntry(entryId: number) {
    tabRouter.push(`/lists/word/${entryId}` as any);
  }

  function handlePressKanji(literal: string) {
    tabRouter.pushKanji(literal);
  }

  return (
    <CustomHeaderScreen>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border" style={webBgStyle}>
        <Pressable onPress={goBack} className="p-1 mr-3">
          <ChevronLeft size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground flex-1">Review Statistics</Text>
      </View>

      {/* Scope toggle */}
      {listId && (
        <View className="flex-row mx-4 mt-3 rounded-lg border border-border overflow-hidden">
          <Pressable
            className={`flex-1 py-2 ${scope === "list" ? "bg-primary" : ""}`}
            onPress={() => setScope("list")}
          >
            <Text
              className={`text-sm text-center font-medium ${scope === "list" ? "text-primary-foreground" : "text-foreground"}`}
            >
              {list?.name ?? "This List"}
            </Text>
          </Pressable>
          <Pressable
            className={`flex-1 py-2 ${scope === "all" ? "bg-primary" : ""}`}
            onPress={() => setScope("all")}
          >
            <Text
              className={`text-sm text-center font-medium ${scope === "all" ? "text-primary-foreground" : "text-foreground"}`}
            >
              All Lists
            </Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Loading stats...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20, gap: 16 }}
        >
          {/* Today Summary — tappable to drill into today */}
          <Pressable onPress={() => setSelectedDay(todayStr)}>
            <Card>
              <Text className="text-sm font-semibold text-muted-foreground mb-3">Today</Text>
              <View className="flex-row flex-wrap">
                <View className="w-1/2 mb-3">
                  <Text className="text-2xl font-bold text-foreground">
                    {todaySummary?.reviews ?? 0}
                  </Text>
                  <Text className="text-xs text-muted-foreground">reviews</Text>
                </View>
                <View className="w-1/2 mb-3">
                  <Text className="text-2xl font-bold text-foreground">
                    {todaySummary && todaySummary.reviews > 0
                      ? `${Math.round(todaySummary.accuracy * 100)}%`
                      : "—"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">accuracy</Text>
                </View>
                <View className="w-1/2">
                  <Text className="text-2xl font-bold text-foreground">
                    {todaySummary && todaySummary.timeMs > 0
                      ? formatDuration(todaySummary.timeMs)
                      : "—"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">active time</Text>
                </View>
                <View className="w-1/2">
                  <Text className="text-2xl font-bold text-foreground">
                    {streak && streak.current > 0 ? `${streak.current} day` : "—"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">streak</Text>
                </View>
              </View>
            </Card>
          </Pressable>

          {/* Today's Mix-ups */}
          {todayClusters.length > 0 && (
            <Card>
              <Text className="text-sm font-semibold text-muted-foreground mb-3">
                Today's Mix-ups
              </Text>
              <ConfusionClusters
                clusters={todayClusters}
                entries={entryMap}
                onPressEntry={handlePressEntry}
                onPressKanji={handlePressKanji}
              />
            </Card>
          )}

          {/* Activity Heatmap — tappable cells */}
          <Card>
            <Text className="text-sm font-semibold text-muted-foreground mb-3">
              Activity (90 days)
            </Text>
            {dailyActivity.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Heatmap
                  data={dailyActivity.map((d) => ({ day: d.day, count: d.reviews }))}
                  onDayPress={setSelectedDay}
                  selectedDay={selectedDay}
                />
              </ScrollView>
            ) : (
              <Text className="text-sm text-muted-foreground">No activity yet</Text>
            )}
          </Card>

          {/* Day Detail — shown when a day is selected */}
          {selectedDay && (
            <Card>
              <DayReviewDetail
                day={selectedDay}
                sessions={dayDetail}
                entries={dayEntries}
                loading={dayLoading}
                onNavigateDay={setSelectedDay}
                onClose={() => setSelectedDay(null)}
                onPressEntry={handlePressEntry}
                onPressKanji={handlePressKanji}
                confusionClusters={dayClusters}
              />
            </Card>
          )}

          {/* This Week */}
          <Card>
            <Text className="text-sm font-semibold text-muted-foreground mb-3">This Week</Text>
            <WeeklyBarChart data={dailyActivity} />
          </Card>

          {/* Due Cards (per-list only) */}
          {scope === "list" && listId && list?.flashcardMode && (
            <Card>
              <DueCardsSection listId={listId} flashcardMode={list.flashcardMode} />
            </Card>
          )}

          {/* Card Distribution (per-list only) */}
          {cardDist && cardDist.total > 0 && (
            <Card>
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-sm font-semibold text-muted-foreground">Cards</Text>
                <Text className="text-xs text-muted-foreground">{cardDist.total} total</Text>
              </View>
              {/* Segmented bar */}
              <View className="h-3 flex-row rounded-full overflow-hidden bg-muted mb-2">
                {cardDist.review > 0 && (
                  <View
                    className="bg-green-600"
                    style={{ width: `${(cardDist.review / cardDist.total) * 100}%` }}
                  />
                )}
                {cardDist.learning + cardDist.relearning > 0 && (
                  <View
                    className="bg-yellow-500"
                    style={{
                      width: `${((cardDist.learning + cardDist.relearning) / cardDist.total) * 100}%`,
                    }}
                  />
                )}
              </View>
              <Text className="text-xs text-muted-foreground">
                {cardDist.review} learned · {cardDist.learning + cardDist.relearning} learning ·{" "}
                {cardDist.newCount} new
              </Text>
            </Card>
          )}

          {/* Recent Sessions */}
          <Card>
            <Text className="text-sm font-semibold text-muted-foreground mb-3">
              Recent Sessions
            </Text>
            {sessions.length > 0 ? (
              <View className="gap-2">
                {sessions.map((s, i) => {
                  const accuracy =
                    s.totalItems > 0 ? Math.round((s.correctCount / s.totalItems) * 100) : 0;
                  return (
                    <View key={`${s.sessionId}-${i}`} className="flex-row items-center gap-3">
                      <View className="w-20">
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                          {formatRelativeTime(s.startedAt)}
                        </Text>
                      </View>
                      <View className="bg-muted px-2 py-0.5 rounded">
                        <Text className="text-xs text-foreground">
                          {practiceModeLabel(s.practiceMode)}
                        </Text>
                      </View>
                      <Text className="text-sm text-foreground flex-1 text-right">{accuracy}%</Text>
                      <Text className="text-xs text-muted-foreground w-10 text-right">
                        {formatDuration(s.durationMs)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text className="text-sm text-muted-foreground">
                Start practicing to see your sessions here
              </Text>
            )}
          </Card>

          {/* Leeches (per-list only) */}
          {leeches.length > 0 && (
            <Card>
              <Text className="text-sm font-semibold text-muted-foreground mb-3">Leeches</Text>
              <View className="gap-2">
                {leeches.slice(0, 5).map((l) => {
                  const display = getEntryDisplay(l.entryId, l.kanjiLiteral);
                  return (
                    <Pressable
                      key={`leech-${l.entryId}-${l.kanjiLiteral}`}
                      className="flex-row items-center justify-between py-1"
                      onPress={() => {
                        if (l.kanjiLiteral) handlePressKanji(l.kanjiLiteral);
                        else handlePressEntry(l.entryId);
                      }}
                    >
                      <Text className="text-base text-foreground">{display}</Text>
                      <Text className="text-xs text-red-400">
                        {Math.round(l.accuracy * 100)}% ({l.totalAttempts} tries)
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          )}

          {/* Problem Clusters */}
          {clusters.length > 0 ? (
            <Card>
              <Text className="text-sm font-semibold text-muted-foreground mb-3">
                Problem Clusters
              </Text>
              <ConfusionClusters
                clusters={clusters}
                entries={entryMap}
                onPressEntry={handlePressEntry}
                onPressKanji={handlePressKanji}
              />
            </Card>
          ) : leeches.length === 0 ? (
            <Card>
              <Text className="text-sm font-semibold text-muted-foreground mb-2">
                Trouble Spots
              </Text>
              <Text className="text-sm text-muted-foreground">No trouble spots found</Text>
            </Card>
          ) : null}
        </ScrollView>
      )}
    </CustomHeaderScreen>
  );
}
