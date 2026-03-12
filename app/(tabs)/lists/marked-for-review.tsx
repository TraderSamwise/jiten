import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronDown, ChevronRight } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { useSync } from "@/db/sync-provider";
import { getEntries } from "@/db/search";
import { getKanjiBatchAsync } from "@/db/kanji-search";
import { useListsStore } from "@/stores/lists";
import { useTabRouter, useSafeGoBack } from "@/lib/navigation";
import { CustomHeaderScreen, useWebBackdrop } from "@/components/CustomHeaderScreen";
import { useAtomValue } from "jotai";
import { dayResetHourAtom } from "@/stores/settings";
import {
  getMarkedByDay,
  getMarkedByWeek,
  getMarkedByMonth,
  type MarkedDay,
  type MarkedWeek,
  type MarkedMonth,
  type MarkEntry,
} from "@/lib/review-marks";
import type { DictEntry, KanjiCharacter } from "@/db/types";

export default function MarkedForReviewScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const tabRouter = useTabRouter();
  const goBack = useSafeGoBack("/lists");
  const { webBgStyle, insets } = useWebBackdrop();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const { lastSyncAt } = useSync();
  const list = useListsStore((s) => s.lists.find((l) => l.id === listId));
  const dayResetHour = useAtomValue(dayResetHourAtom);

  const [scope, setScope] = useState<"list" | "all">(listId ? "list" : "all");
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<MarkedDay[]>([]);
  const [weeks, setWeeks] = useState<MarkedWeek[]>([]);
  const [months, setMonths] = useState<MarkedMonth[]>([]);
  const [entryMap, setEntryMap] = useState<Map<number, DictEntry>>(new Map());
  const [kanjiMap, setKanjiMap] = useState<Map<string, KanjiCharacter>>(new Map());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["days"]));
  const [expandedBins, setExpandedBins] = useState<Set<string>>(new Set());
  const [creatingStudy, setCreatingStudy] = useState<string | null>(null);

  const effectiveListId = scope === "list" ? listId : undefined;

  useEffect(() => {
    loadData();
  }, [userDb, dictDb, scope, listId, dayResetHour, lastSyncAt]);

  async function loadData() {
    if (!userDb) return;
    setLoading(true);

    const lid = effectiveListId ?? null;
    const [d, w, m] = await Promise.all([
      getMarkedByDay(userDb, dayResetHour, lid),
      getMarkedByWeek(userDb, dayResetHour, lid),
      getMarkedByMonth(userDb, dayResetHour, lid),
    ]);
    setDays(d);
    setWeeks(w);
    setMonths(m);

    // Resolve entries for display
    if (dictDb) {
      const allMarks = [...d, ...w, ...m].flatMap((g) => g.marks);
      const wordIds = new Set<number>();
      const kanjiLits = new Set<string>();
      for (const mark of allMarks) {
        if (mark.kanjiLiteral) kanjiLits.add(mark.kanjiLiteral);
        else if (mark.entryId) wordIds.add(mark.entryId);
      }
      const [entries, kanjis] = await Promise.all([
        wordIds.size > 0 ? getEntries(dictDb, [...wordIds]) : [],
        kanjiLits.size > 0 ? getKanjiBatchAsync(dictDb, [...kanjiLits]) : [],
      ]);
      setEntryMap(new Map(entries.map((e) => [e.id, e])));
      setKanjiMap(new Map(kanjis.map((k) => [k.literal, k])));
    }

    setLoading(false);
  }

  function toggleSection(section: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function toggleBin(bin: string) {
    setExpandedBins((prev) => {
      const next = new Set(prev);
      if (next.has(bin)) next.delete(bin);
      else next.add(bin);
      return next;
    });
  }

  async function handleStudy(marks: MarkEntry[], label: string) {
    if (!userDb || marks.length === 0) return;
    const key = label;
    setCreatingStudy(key);

    try {
      const now = new Date().toISOString();
      const tempId = `_marked_${Date.now()}`;

      await userDb.runAsync(
        `INSERT OR IGNORE INTO lists (id, name, description, created_at, updated_at, flashcard_mode, configured)
         VALUES (?, ?, '', ?, ?, 'simple_srs', 1)`,
        [tempId, `Marked — ${label}`, now, now],
      );

      // Deduplicate marks by entryId+kanjiLiteral
      const seen = new Set<string>();
      const uniqueMarks: MarkEntry[] = [];
      for (const mark of marks) {
        const mKey = `${mark.entryId}-${mark.kanjiLiteral ?? ""}`;
        if (!seen.has(mKey)) {
          seen.add(mKey);
          uniqueMarks.push(mark);
        }
      }

      for (const mark of uniqueMarks) {
        const entryRowId = `${tempId}-${mark.entryId}-${mark.kanjiLiteral ?? ""}`;
        await userDb.runAsync(
          `INSERT OR IGNORE INTO list_entries (id, list_id, entry_id, kanji_literal, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entryRowId, tempId, mark.entryId, mark.kanjiLiteral, now, now],
        );
      }

      router.push(`/lists/study?listId=${tempId}`);
    } catch (err) {
      console.error("[MarkedForReview] Failed to create temp list:", err);
    } finally {
      setCreatingStudy(null);
    }
  }

  function handlePressMark(mark: MarkEntry) {
    if (mark.kanjiLiteral) {
      tabRouter.pushKanji(mark.kanjiLiteral);
    } else {
      tabRouter.push(`/lists/word/${mark.entryId}` as any);
    }
  }

  function getMarkDisplay(mark: MarkEntry): { title: string; subtitle: string } {
    if (mark.kanjiLiteral) {
      const kanji = kanjiMap.get(mark.kanjiLiteral);
      return {
        title: mark.kanjiLiteral,
        subtitle: kanji?.meanings.slice(0, 3).join(", ") ?? "",
      };
    }
    const entry = entryMap.get(mark.entryId);
    if (!entry) return { title: `#${mark.entryId}`, subtitle: "" };
    const kanjiText = entry.kanji[0]?.text ?? "";
    const reading = entry.kana[0]?.text ?? "";
    const gloss = entry.senses[0]?.glosses[0]?.text ?? "";
    return {
      title: kanjiText || reading,
      subtitle: kanjiText ? `${reading} — ${gloss}` : gloss,
    };
  }

  function renderBinRow(key: string, label: string, count: number, marks: MarkEntry[]) {
    const isExpanded = expandedBins.has(key);
    return (
      <View key={key}>
        <Pressable
          className="flex-row items-center justify-between px-4 py-3 border-b border-border"
          onPress={() => toggleBin(key)}
        >
          <View className="flex-row items-center flex-1 gap-2">
            <ChevronRight
              size={14}
              className="text-muted-foreground"
              style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
            />
            <Text className="text-sm text-foreground">{label}</Text>
            <Text className="text-xs text-muted-foreground">{count}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            label={creatingStudy === label ? "..." : "Study"}
            onPress={() => handleStudy(marks, label)}
          />
        </Pressable>
        {isExpanded &&
          marks.map((mark, idx) => {
            const display = getMarkDisplay(mark);
            return (
              <Pressable
                key={`${mark.entryId}-${mark.kanjiLiteral ?? ""}-${idx}`}
                className="flex-row items-center px-6 py-2.5 border-b border-border/50"
                onPress={() => handlePressMark(mark)}
              >
                <Text className="text-base text-foreground mr-2" style={{ minWidth: 40 }}>
                  {display.title}
                </Text>
                <Text className="text-sm text-muted-foreground flex-1" numberOfLines={1}>
                  {display.subtitle}
                </Text>
              </Pressable>
            );
          })}
      </View>
    );
  }

  function renderSection<T extends { marks: MarkEntry[] }>(
    sectionKey: string,
    title: string,
    items: T[],
    getKey: (item: T) => string,
    getLabel: (item: T) => string,
  ) {
    const isExpanded = expandedSections.has(sectionKey);
    return (
      <View className="border border-border rounded-lg overflow-hidden">
        <Pressable
          className="flex-row items-center justify-between px-4 py-3 bg-secondary/50"
          onPress={() => toggleSection(sectionKey)}
        >
          <Text className="text-sm font-medium text-foreground">{title}</Text>
          <ChevronDown
            size={16}
            className="text-muted-foreground"
            style={{ transform: [{ rotate: isExpanded ? "0deg" : "-90deg" }] }}
          />
        </Pressable>
        {isExpanded &&
          (items.length > 0 ? (
            items.map((item) =>
              renderBinRow(
                `${sectionKey}-${getKey(item)}`,
                getLabel(item),
                item.marks.length,
                item.marks,
              ),
            )
          ) : (
            <View className="px-4 py-3">
              <Text className="text-sm text-muted-foreground">None</Text>
            </View>
          ))}
      </View>
    );
  }

  const isEmpty = days.length === 0 && weeks.length === 0 && months.length === 0;

  return (
    <CustomHeaderScreen>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border" style={webBgStyle}>
        <Pressable onPress={goBack} className="p-1 mr-3">
          <ChevronLeft size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground flex-1">Marked for Review</Text>
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
          <ActivityIndicator />
        </View>
      ) : isEmpty ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted-foreground text-center">
            No marked cards yet. Flag cards during review to see them here.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20, gap: 16 }}
        >
          {renderSection(
            "days",
            "Days",
            days,
            (d) => d.dayLabel,
            (d) => d.displayLabel,
          )}
          {renderSection(
            "weeks",
            "Weeks",
            weeks,
            (w) => w.weekLabel,
            (w) => w.displayLabel,
          )}
          {renderSection(
            "months",
            "Months",
            months,
            (m) => m.monthLabel,
            (m) => m.displayLabel,
          )}
        </ScrollView>
      )}
    </CustomHeaderScreen>
  );
}
