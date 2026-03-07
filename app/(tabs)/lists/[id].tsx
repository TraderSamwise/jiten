import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Pressable, InteractionManager, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from "expo-router";
import { useTabRouter } from "@/lib/navigation";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PressableCard } from "@/components/ui/card";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { ListEntryCard } from "@/components/ListEntryCard";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { GamesModal } from "@/components/GamesModal";
import { Trash2, EllipsisVertical } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getEntries } from "@/db/search";
import { getKanjiBatchAsync } from "@/db/kanji-search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore, parseListRow } from "@/stores/lists";
import { ExportListModal } from "@/components/ExportListModal";
import { softDelete } from "@/db/sync-helpers";
import { listItemKey } from "@/db/types";
import type { ListItem, KanjiCharacter, DictEntry } from "@/db/types";

const PAGE_SIZE = 100;

type ListEntryRow = { entry_id: number; kanji_literal: string | null };

/** Resolve a page of ListEntryRows into full ListItems */
async function resolvePageItems(dictDb: any, rows: ListEntryRow[]): Promise<ListItem[]> {
  const wordEntryIds: number[] = [];
  const kanjiLiterals: string[] = [];
  for (const r of rows) {
    if (r.kanji_literal != null) kanjiLiterals.push(r.kanji_literal);
    else wordEntryIds.push(r.entry_id);
  }

  const [wordEntries, kanjiEntries] = await Promise.all([
    wordEntryIds.length > 0 ? getEntries(dictDb, wordEntryIds) : Promise.resolve([]),
    kanjiLiterals.length > 0 ? getKanjiBatchAsync(dictDb, kanjiLiterals) : Promise.resolve([]),
  ]);

  const entryMap = new Map(wordEntries.map((e: DictEntry) => [e.id, e]));
  const kanjiMap = new Map(kanjiEntries.map((k: KanjiCharacter) => [k.literal, k]));

  const items: ListItem[] = [];
  for (const r of rows) {
    if (r.kanji_literal != null) {
      const k = kanjiMap.get(r.kanji_literal);
      if (k) items.push({ kind: "kanji", kanji: k });
    } else {
      const e = entryMap.get(r.entry_id);
      if (e) items.push({ kind: "entry", entry: e });
    }
  }
  return items;
}

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const tabRouter = useTabRouter();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const [items, setItems] = useState<ListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const allRowsRef = useRef<ListEntryRow[]>([]);
  const loadedCountRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [gamesModalVisible, setGamesModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const list = useListsStore((s) => s.lists.find((l) => l.id === id));

  // Load list from DB if not in store (e.g. direct navigation / refresh)

  useEffect(() => {
    if (!list && userDb && id) {
      loadListFromDb();
    }
  }, [list, userDb, id]);

  async function loadListFromDb() {
    if (!userDb || !id) return;
    const row = await userDb.getFirstAsync<any>(
      `SELECT l.*, COUNT(le.id) as entryCount
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id AND le.deleted_at IS NULL
       WHERE l.id = ? AND l.deleted_at IS NULL GROUP BY l.id`,
      [id],
    );
    if (row) {
      const parsed = parseListRow(row);
      useListsStore.getState().addList(parsed);
    }
  }

  useEffect(() => {
    if (list) {
      navigation.setOptions({
        title: list.name,
        headerRight: () => (
          <Pressable onPress={() => setMenuVisible((v) => !v)} className="mr-2 p-2">
            <EllipsisVertical size={20} className="text-foreground" />
          </Pressable>
        ),
      });
    }
  }, [list?.name]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadEntries();
    });
    return () => task.cancel();
  }, [userDb, dictDb, id]);

  useFocusEffect(
    useCallback(() => {
      setStudyLoading(false);
    }, []),
  );

  useEffect(() => {
    if (totalCount > 0 && list) {
      updateStudyCount();
    } else {
      setReviewCount(0);
      setNewCount(0);
    }
  }, [totalCount, list?.flashcardMode, list?.studyPosition]);

  async function updateStudyCount() {
    if (!userDb || !list || !id) return;
    if (list.flashcardMode === "add_order") {
      const remaining = totalCount - (list.studyPosition ?? 0);
      setReviewCount(Math.max(0, remaining));
      setNewCount(0);
    } else {
      const reviewRow = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM srs_cards WHERE list_id = ? AND state != 0 AND due <= ? AND deleted_at IS NULL",
        [id, new Date().toISOString()],
      );
      const newRow = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM srs_cards WHERE list_id = ? AND state = 0 AND deleted_at IS NULL",
        [id],
      );
      setReviewCount(reviewRow?.count ?? 0);
      setNewCount(newRow?.count ?? 0);
    }
  }

  async function loadEntries() {
    if (!userDb || !dictDb || !id) return;
    setLoading(true);

    // Step 1: Load just the IDs (fast, tiny data even for 8000+ entries)
    const rows = await userDb.getAllAsync<ListEntryRow>(
      "SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ? AND deleted_at IS NULL ORDER BY added_at DESC",
      [id],
    );

    allRowsRef.current = rows;
    setTotalCount(rows.length);

    if (rows.length === 0) {
      setItems([]);
      loadedCountRef.current = 0;
      setLoading(false);
      return;
    }

    // Step 2: Load only the first page of full entry details
    const firstPage = rows.slice(0, PAGE_SIZE);
    const resolved = await resolvePageItems(dictDb, firstPage);
    loadedCountRef.current = PAGE_SIZE;
    setItems(resolved);
    setLoading(false);
  }

  const loadMore = useCallback(async () => {
    if (!dictDb || loadingMore) return;
    const rows = allRowsRef.current;
    const loaded = loadedCountRef.current;
    if (loaded >= rows.length) return;

    setLoadingMore(true);
    const nextPage = rows.slice(loaded, loaded + PAGE_SIZE);
    const resolved = await resolvePageItems(dictDb, nextPage);
    loadedCountRef.current = loaded + PAGE_SIZE;
    setItems((prev) => [...prev, ...resolved]);
    setLoadingMore(false);
  }, [dictDb, loadingMore]);

  async function handleRemoveItem(item: ListItem) {
    if (!userDb) return;

    if (item.kind === "kanji") {
      const literal = item.kanji.literal;
      await softDelete(userDb, "list_entries", "list_id = ? AND kanji_literal = ?", [id, literal]);
      await softDelete(userDb, "srs_cards", "list_id = ? AND kanji_literal = ?", [id, literal]);
      const remaining = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM list_entries WHERE kanji_literal = ? AND deleted_at IS NULL",
        [literal],
      );
      if (!remaining || remaining.count === 0) {
        useBookmarkStore.getState().remove(`k:${literal}`);
      }
    } else {
      const entryId = item.entry.id;
      await softDelete(
        userDb,
        "list_entries",
        "list_id = ? AND entry_id = ? AND kanji_literal IS NULL",
        [id, entryId],
      );
      await softDelete(
        userDb,
        "srs_cards",
        "list_id = ? AND entry_id = ? AND kanji_literal IS NULL",
        [id, entryId],
      );
      const remaining = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM list_entries WHERE entry_id = ? AND kanji_literal IS NULL AND deleted_at IS NULL",
        [entryId],
      );
      if (!remaining || remaining.count === 0) {
        useBookmarkStore.getState().remove(`e:${entryId}`);
      }
    }

    // Update local state
    const key = listItemKey(item);
    setItems((prev) => prev.filter((i) => listItemKey(i) !== key));
    setTotalCount((prev) => prev - 1);
    allRowsRef.current = allRowsRef.current.filter((r) =>
      item.kind === "kanji"
        ? r.kanji_literal !== item.kanji.literal
        : r.entry_id !== item.entry.id || r.kanji_literal != null,
    );

    // Update entry count in lists store
    const currentList = useListsStore.getState().lists.find((l) => l.id === id);
    if (currentList) {
      useListsStore.getState().updateList(id!, {
        entryCount: (currentList.entryCount ?? 1) - 1,
      });
    }
  }

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      const actions: SwipeAction[] = list?.isDefault
        ? []
        : [
            {
              label: "Remove",
              icon: Trash2,
              color: "#ef4444",
              onPress: () => handleRemoveItem(item),
            },
          ];

      if (item.kind === "kanji") {
        const isBookmarked = useBookmarkStore
          .getState()
          .bookmarkedIds.has(`k:${item.kanji.literal}`);
        const bookmarkClass = isBookmarked ? "border-l-4 border-l-primary bg-primary/5 pl-2" : "";
        return (
          <SwipeableRow actions={actions}>
            <PressableCard
              className="mb-1 p-3"
              onPress={() => tabRouter.pushKanji(item.kanji.literal)}
            >
              <View className={bookmarkClass}>
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-lg font-bold text-foreground">{item.kanji.literal}</Text>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {[...item.kanji.readingsOn, ...item.kanji.readingsKun].join("、")}
                  </Text>
                  <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                    {item.kanji.meanings.join(", ")}
                  </Text>
                </View>
                {(item.kanji.jlptLevel != null || item.kanji.grade != null) && (
                  <View className="flex-row gap-1 mt-1">
                    {item.kanji.jlptLevel != null && (
                      <Badge variant="secondary" label={`N${item.kanji.jlptLevel}`} />
                    )}
                    {item.kanji.grade != null && (
                      <Badge variant="secondary" label={`Grade ${item.kanji.grade}`} />
                    )}
                  </View>
                )}
              </View>
            </PressableCard>
          </SwipeableRow>
        );
      }

      return (
        <SwipeableRow actions={actions}>
          <ListEntryCard entry={item.entry} />
        </SwipeableRow>
      );
    },
    [userDb, id, list?.isDefault],
  );

  const [studyLoading, setStudyLoading] = useState(false);
  function handleStudy() {
    if (!list?.configured) {
      setSetupMode(true);
      setSettingsVisible(true);
    } else {
      setStudyLoading(true);
      setTimeout(() => router.push(`/lists/study?listId=${id}`), 100);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading list...</Text>
      </View>
    );
  }

  const studyLabel =
    list?.flashcardMode === "srs"
      ? reviewCount > 0 && newCount > 0
        ? `Study (${reviewCount} due, ${newCount} new)`
        : reviewCount > 0
          ? `Study (${reviewCount} due)`
          : newCount > 0
            ? `Study (${newCount} new)`
            : "Study"
      : `Study (${totalCount} cards)`;

  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => listItemKey(item)}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 80,
        }}
        ListEmptyComponent={
          <View className="items-center pt-10">
            <Text className="text-muted-foreground text-center">
              This list is empty.{"\n"}Search for words and add them here.
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" />
            </View>
          ) : null
        }
      />

      {/* Sticky study footer */}
      <View className="absolute bottom-0 left-0 right-0 border-t border-border bg-background px-4 py-3">
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            onPress={handleStudy}
            disabled={
              studyLoading ||
              (list?.flashcardMode === "srs"
                ? reviewCount === 0 && newCount === 0
                : totalCount === 0)
            }
            style={studyLoading ? { opacity: 1 } : undefined}
          >
            <Text className="font-medium text-base text-primary-foreground">{studyLabel}</Text>
            {studyLoading && (
              <ActivityIndicator size="small" className="text-primary-foreground ml-2" />
            )}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            label="Games"
            onPress={() => setGamesModalVisible(true)}
            disabled={totalCount === 0}
          />
        </View>
      </View>

      {/* Dropdown menu */}
      {menuVisible && (
        <>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={() => setMenuVisible(false)}
          />
          <View className="absolute top-0 right-4 z-10 mt-1 rounded-lg border border-border bg-background shadow-lg min-w-[180px]">
            <Pressable
              className="px-4 py-3 border-b border-border"
              onPress={() => {
                setMenuVisible(false);
                setSettingsVisible(true);
              }}
            >
              <Text className="text-sm text-foreground">Flashcard Settings</Text>
            </Pressable>
            <Pressable
              className="px-4 py-3 border-b border-border"
              onPress={() => {
                setMenuVisible(false);
                router.push(`/lists/stats?listId=${id}`);
              }}
            >
              <Text className="text-sm text-foreground">Practice Stats</Text>
            </Pressable>
            <Pressable
              className="px-4 py-3"
              onPress={() => {
                setMenuVisible(false);
                setExportModalVisible(true);
              }}
            >
              <Text className="text-sm text-foreground">Export List</Text>
            </Pressable>
          </View>
        </>
      )}

      <FlashcardSettingsModal
        visible={settingsVisible}
        onClose={() => {
          setSettingsVisible(false);
          setSetupMode(false);
        }}
        listId={id!}
        onStartStudy={
          setupMode
            ? () => {
                setSettingsVisible(false);
                setSetupMode(false);
                router.push(`/lists/study?listId=${id}`);
              }
            : undefined
        }
      />

      <ExportListModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        listId={id!}
        listName={list?.name ?? ""}
      />

      <GamesModal
        visible={gamesModalVisible}
        onClose={() => setGamesModalVisible(false)}
        listId={id!}
      />
    </View>
  );
}
