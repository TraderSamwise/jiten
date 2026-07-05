import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Pressable,
  InteractionManager,
  ActivityIndicator,
  Platform,
  TextInput,
  ScrollView,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from "expo-router";
import { useTabRouter } from "@/lib/navigation";
import { BOOKMARK_HIGHLIGHT_CLASS, BOOKMARK_HIGHLIGHT_STYLE } from "@/lib/bookmark-styles";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PressableCard } from "@/components/ui/card";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { ListEntryCard } from "@/components/ListEntryCard";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { GamesModal } from "@/components/GamesModal";
import { SmartReviewModal } from "@/components/SmartReviewModal";
import { Trash2, EllipsisVertical, Check } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getEntries, searchListEntries } from "@/db/search";
import { getKanjiBatchAsync } from "@/db/kanji-search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore, parseListRow, type ListScrollCache } from "@/stores/lists";
import {
  useListSortMode,
  isDictSort,
  SORT_ORDER,
  SORT_LABELS,
  KANJI_ONLY_MODES,
} from "@/stores/list-sort";
import { sortRowsByDictKey } from "@/lib/list-sort-keys";
import { ExportListModal } from "@/components/ExportListModal";
import { softDelete } from "@/db/sync-helpers";
import { useSync } from "@/db/sync-provider";
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
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
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
  const loadingMoreRef = useRef(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [gamesModalVisible, setGamesModalVisible] = useState(false);
  const [smartReviewVisible, setSmartReviewVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const flashListRef = useRef<FlashListRef<ListItem>>(null);
  const [search, setSearch] = useState(q ?? "");
  const [searchResults, setSearchResults] = useState<ListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { lastSyncAt } = useSync();
  const list = useListsStore((s) => s.lists.find((l) => l.id === id));
  const restoredOffsetRef = useRef<number | null>(null);
  const [sortMode, setSortMode] = useListSortMode(id);
  const [hasKanji, setHasKanji] = useState(false);

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

  // Initial load (with spinner)
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadEntries();
    });
    return () => task.cancel();
  }, [userDb, dictDb, id]);

  // Reload when the sort changes (also fires once when the persisted sort
  // hydrates from storage after the initial "list"-order render).
  const sortInitRef = useRef(true);
  useEffect(() => {
    if (sortInitRef.current) {
      sortInitRef.current = false;
      return;
    }
    if (!userDb || !dictDb || !id) return;
    if (Platform.OS === "web") useListsStore.getState().clearScrollCache(id);
    flashListRef.current?.scrollToOffset({ offset: 0, animated: false });
    loadEntriesFresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

  // Silent refresh after sync (no spinner — entries already visible)
  const prevSyncAt = useRef(lastSyncAt);
  useEffect(() => {
    if (prevSyncAt.current === lastSyncAt) return;
    prevSyncAt.current = lastSyncAt;
    if (lastSyncAt && items.length > 0) {
      loadEntriesFresh(true);
    }
  }, [lastSyncAt]);

  useFocusEffect(
    useCallback(() => {
      setStudyLoading(false);
    }, []),
  );

  // Web only: restore scroll position from cache after hydration
  const hasItems = items.length > 0;
  useEffect(() => {
    if (Platform.OS !== "web" || !hasItems) return;
    const offset = restoredOffsetRef.current;
    if (offset == null || offset <= 0) return;
    restoredOffsetRef.current = null;
    requestAnimationFrame(() => {
      flashListRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [hasItems]);

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

    // Web only: try to restore from scroll cache
    if (Platform.OS === "web") {
      const cached = useListsStore.getState().getScrollCache(id);
      if (cached && cached.items.length > 0) {
        allRowsRef.current = cached.allRows;
        loadedCountRef.current = cached.loadedCount;
        setTotalCount(cached.totalCount);
        setHasKanji(cached.allRows.some((r) => r.kanji_literal != null));
        setItems(cached.items);
        restoredOffsetRef.current = cached.scrollOffset;
        setLoading(false);

        // Background staleness check
        userDb
          .getFirstAsync<{
            count: number;
          }>(
            "SELECT COUNT(*) as count FROM list_entries WHERE list_id = ? AND deleted_at IS NULL",
            [id],
          )
          .then((row) => {
            if (row && row.count !== cached.totalCount) {
              useListsStore.getState().clearScrollCache(id);
              loadEntriesFresh();
            }
          });
        return;
      }
    }

    await loadEntriesFresh();
  }

  async function loadEntriesFresh(silent = false) {
    if (!userDb || !dictDb || !id) return;
    if (!silent) setLoading(true);

    // Step 1: Load just the IDs (fast, tiny data even for 8000+ entries).
    // "added" sorts newest-first in SQL; every other mode starts from list order
    // and dict-derived modes then re-sort in JS (dict data is in a separate DB).
    const orderBy =
      sortMode === "added"
        ? "ORDER BY added_at DESC, id ASC"
        : "ORDER BY position ASC, added_at ASC, id ASC";
    let rows = await userDb.getAllAsync<ListEntryRow>(
      `SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ? AND deleted_at IS NULL ${orderBy}`,
      [id],
    );
    setHasKanji(rows.some((r) => r.kanji_literal != null));
    if (isDictSort(sortMode)) {
      rows = await sortRowsByDictKey(dictDb, rows, sortMode);
    }

    allRowsRef.current = rows;
    setTotalCount(rows.length);

    if (rows.length === 0) {
      setItems([]);
      loadedCountRef.current = 0;
      setLoading(false);
      if (Platform.OS === "web") {
        useListsStore.getState().clearScrollCache(id);
      }
      return;
    }

    // Step 2: Load only the first page of full entry details
    const firstPage = rows.slice(0, PAGE_SIZE);
    const resolved = await resolvePageItems(dictDb, firstPage);
    loadedCountRef.current = PAGE_SIZE;
    setItems(resolved);
    setLoading(false);

    if (Platform.OS === "web") {
      useListsStore.getState().setScrollCache(id, {
        scrollOffset: 0,
        items: resolved,
        allRows: rows,
        loadedCount: PAGE_SIZE,
        totalCount: rows.length,
      });
    }
  }

  const loadMore = useCallback(async () => {
    if (!dictDb || loadingMoreRef.current) return;
    const rows = allRowsRef.current;
    const loaded = loadedCountRef.current;
    if (loaded >= rows.length) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = rows.slice(loaded, loaded + PAGE_SIZE);
    const resolved = await resolvePageItems(dictDb, nextPage);
    const newLoaded = loaded + PAGE_SIZE;
    loadedCountRef.current = newLoaded;
    setItems((prev) => [...prev, ...resolved]);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [dictDb, id]);

  // Search within list — debounced, queries dict DB then intersects with list entries
  const runSearch = useCallback(
    async (query: string) => {
      if (!dictDb || !userDb || !id) return;
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchResults(null);
        setSearching(false);
        return;
      }

      setSearching(true);

      // Build set of word entry IDs in this list
      const allRows = allRowsRef.current;
      const wordIds = new Set<number>();
      const kanjiLiterals: string[] = [];
      for (const r of allRows) {
        if (r.kanji_literal != null) kanjiLiterals.push(r.kanji_literal);
        else wordIds.add(r.entry_id);
      }

      // Search word entries via dict DB
      const matchedWordIds = await searchListEntries(dictDb, trimmed, wordIds);
      const wordItems =
        matchedWordIds.length > 0
          ? await resolvePageItems(
              dictDb,
              matchedWordIds.map((eid) => ({ entry_id: eid, kanji_literal: null })),
            )
          : [];

      // Search kanji entries by literal or meaning (simple client match — kanji lists are small)
      const lower = trimmed.toLowerCase();
      const matchedKanji = kanjiLiterals.filter((lit) => lit.includes(trimmed));
      // Also match by meaning if input is ascii
      let kanjiByMeaning: string[] = [];
      if (/^[a-zA-Z\s]+$/.test(trimmed) && kanjiLiterals.length > 0) {
        const allKanji = await getKanjiBatchAsync(dictDb, kanjiLiterals);
        kanjiByMeaning = allKanji
          .filter((k) => k.meanings.some((m) => m.toLowerCase().includes(lower)))
          .map((k) => k.literal);
      }
      const uniqueKanji = [...new Set([...matchedKanji, ...kanjiByMeaning])];
      const kanjiItems: ListItem[] =
        uniqueKanji.length > 0
          ? (await getKanjiBatchAsync(dictDb, uniqueKanji)).map((k) => ({
              kind: "kanji" as const,
              kanji: k,
            }))
          : [];

      setSearchResults([...kanjiItems, ...wordItems]);
      setSearching(false);
    },
    [dictDb, userDb, id],
  );

  // Trigger search on query change
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const trimmed = search.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchResults([]);
    searchDebounceRef.current = setTimeout(() => runSearch(trimmed), 250);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search, runSearch]);

  // Web only: onScroll handler for caching scroll position + manual pagination.
  // We handle pagination here instead of onEndReached on web to avoid
  // FlashList's internal layout effects creating a feedback loop with setState.
  const handleScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      if (Platform.OS !== "web" || !id) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      // Cache scroll position (direct mutation, no Zustand re-render)
      const cached = useListsStore.getState().scrollCache[id];
      if (cached) {
        cached.scrollOffset = contentOffset.y;
      }
      // Manual pagination: trigger loadMore when near the end
      const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceFromEnd < layoutMeasurement.height * 0.5 && distanceFromEnd >= 0) {
        loadMore();
      }
    },
    [id, loadMore],
  );

  // Web only: keep scroll cache items in sync after each render (outside layout phase)
  useEffect(() => {
    if (Platform.OS !== "web" || !id || items.length === 0) return;
    const cached = useListsStore.getState().scrollCache[id];
    if (cached) {
      cached.items = items;
      cached.loadedCount = loadedCountRef.current;
    }
  }, [items, id]);

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
        return (
          <SwipeableRow actions={actions}>
            <PressableCard
              className="mb-1 p-3"
              onPress={() => tabRouter.pushKanji(item.kanji.literal)}
            >
              <View
                className={isBookmarked ? BOOKMARK_HIGHLIGHT_CLASS : undefined}
                style={isBookmarked ? BOOKMARK_HIGHLIGHT_STYLE : undefined}
              >
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
      {searching && (
        <View className="absolute inset-0 z-10 items-center justify-center" pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}
      <FlashList
        ref={flashListRef}
        data={searchResults ?? items}
        renderItem={renderItem}
        keyExtractor={(item) => listItemKey(item)}
        onEndReached={searchResults ? undefined : Platform.OS === "web" ? undefined : loadMore}
        onEndReachedThreshold={0.5}
        onScroll={searchResults ? undefined : Platform.OS === "web" ? handleScroll : undefined}
        scrollEventThrottle={Platform.OS === "web" ? 200 : undefined}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 80,
        }}
        ListHeaderComponent={
          totalCount > 0 ? (
            <View className="mb-2">
              <TextInput
                className="h-10 rounded-lg border border-border bg-background px-3 text-foreground"
                placeholder={`Search ${totalCount} entries...`}
                placeholderTextColor="#999"
                value={search}
                onChangeText={(text) => {
                  setSearch(text);
                  router.setParams(text.trim() ? { q: text.trim() } : { q: "" });
                }}
                clearButtonMode="while-editing"
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !searching ? (
            <View className="items-center pt-10">
              <Text className="text-muted-foreground text-center">
                {search.trim()
                  ? "No matching entries."
                  : "This list is empty.\nSearch for words and add them here."}
              </Text>
            </View>
          ) : null
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
          <View className="absolute top-0 right-4 z-10 mt-1 rounded-lg border border-border bg-background shadow-lg min-w-[200px]">
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View className="px-4 py-2 border-b border-border">
                <Text className="text-xs font-semibold uppercase text-muted-foreground">
                  Sort by
                </Text>
              </View>
              {SORT_ORDER.filter((m) => hasKanji || !KANJI_ONLY_MODES.includes(m)).map((m) => (
                <Pressable
                  key={m}
                  className="flex-row items-center justify-between px-4 py-3 border-b border-border"
                  onPress={() => {
                    setMenuVisible(false);
                    setSortMode(m);
                  }}
                >
                  <Text className="text-sm text-foreground">{SORT_LABELS[m]}</Text>
                  {sortMode === m && <Check size={16} className="text-primary" />}
                </Pressable>
              ))}
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
                <Text className="text-sm text-foreground">Review Statistics</Text>
              </Pressable>
              <Pressable
                className="px-4 py-3 border-b border-border"
                onPress={() => {
                  setMenuVisible(false);
                  router.push(`/lists/marked-for-review?listId=${id}`);
                }}
              >
                <Text className="text-sm text-foreground">Marked for Review</Text>
              </Pressable>
              {!list?.isDefault && (
                <Pressable
                  className="px-4 py-3 border-b border-border"
                  onPress={() => {
                    setMenuVisible(false);
                    setSmartReviewVisible(true);
                  }}
                >
                  <Text className="text-sm text-foreground">Smart Review</Text>
                </Pressable>
              )}
              <Pressable
                className="px-4 py-3"
                onPress={() => {
                  setMenuVisible(false);
                  setExportModalVisible(true);
                }}
              >
                <Text className="text-sm text-foreground">Export List</Text>
              </Pressable>
            </ScrollView>
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

      <SmartReviewModal
        visible={smartReviewVisible}
        onClose={() => setSmartReviewVisible(false)}
        sourceList={list}
      />
    </View>
  );
}
