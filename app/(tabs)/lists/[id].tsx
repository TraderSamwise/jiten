import React, { useEffect, useState, useCallback } from "react";
import { View, FlatList, Pressable } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { ListEntryCard } from "@/components/ListEntryCard";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { Trash2, EllipsisVertical } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getEntries } from "@/db/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore, parseListRow } from "@/stores/lists";
import { ExportListModal } from "@/components/ExportListModal";
import type { DictEntry } from "@/db/types";

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
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
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id
       WHERE l.id = ? GROUP BY l.id`,
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
    loadEntries();
  }, [userDb, dictDb, id]);

  useEffect(() => {
    if (entries.length > 0 && list) {
      updateStudyCount();
    } else {
      setReviewCount(0);
      setNewCount(0);
    }
  }, [entries.length, list?.flashcardMode, list?.studyPosition]);

  async function updateStudyCount() {
    if (!userDb || !list || !id) return;
    if (list.flashcardMode === "add_order") {
      const remaining = entries.length - (list.studyPosition ?? 0);
      setReviewCount(Math.max(0, remaining));
      setNewCount(0);
    } else {
      const reviewRow = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM srs_cards WHERE list_id = ? AND state != 0 AND due <= ?",
        [id, new Date().toISOString()],
      );
      const newRow = await userDb.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM srs_cards WHERE list_id = ? AND state = 0",
        [id],
      );
      setReviewCount(reviewRow?.count ?? 0);
      setNewCount(newRow?.count ?? 0);
    }
  }

  async function loadEntries() {
    if (!userDb || !dictDb || !id) return;
    setLoading(true);

    const rows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at DESC",
      [id],
    );

    if (rows.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const entryIds = rows.map((r: { entry_id: number }) => r.entry_id);
    const fetched = await getEntries(dictDb, entryIds);

    // Preserve the order from list_entries
    const entryMap = new Map(fetched.map((e: DictEntry) => [e.id, e]));
    const ordered = entryIds
      .map((eid: number) => entryMap.get(eid))
      .filter((e: DictEntry | undefined): e is DictEntry => e !== undefined);

    setEntries(ordered);
    setLoading(false);
  }

  async function handleRemoveEntry(entryId: number) {
    if (!userDb) return;

    // Remove from list_entries
    await userDb.runAsync("DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?", [
      id,
      entryId,
    ]);

    // Remove associated SRS cards for this list
    await userDb.runAsync("DELETE FROM srs_cards WHERE list_id = ? AND entry_id = ?", [
      id,
      entryId,
    ]);

    // Check if entry is still in any list
    const remaining = await userDb.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM list_entries WHERE entry_id = ?",
      [entryId],
    );

    if (!remaining || remaining.count === 0) {
      useBookmarkStore.getState().remove(entryId);
    }

    // Update local state
    setEntries((prev) => prev.filter((e) => e.id !== entryId));

    // Update entry count in lists store
    const currentList = useListsStore.getState().lists.find((l) => l.id === id);
    if (currentList) {
      useListsStore.getState().updateList(id!, {
        entryCount: (currentList.entryCount ?? 1) - 1,
      });
    }
  }

  const renderItem = useCallback(
    ({ item }: { item: DictEntry }) => {
      const actions: SwipeAction[] = [
        {
          label: "Remove",
          icon: Trash2,
          color: "#ef4444",
          onPress: () => handleRemoveEntry(item.id),
        },
      ];

      return (
        <SwipeableRow actions={actions}>
          <ListEntryCard entry={item} />
        </SwipeableRow>
      );
    },
    [userDb, id],
  );

  function handleStudy() {
    if (!list?.configured) {
      setSetupMode(true);
      setSettingsVisible(true);
    } else {
      router.push(`/lists/study?listId=${id}`);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
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
      : `Study (${entries.length} cards)`;

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={entries}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
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
      />

      {/* Sticky study footer */}
      <View className="absolute bottom-0 left-0 right-0 border-t border-border bg-background px-4 py-3">
        <Button
          label={studyLabel}
          onPress={handleStudy}
          disabled={
            list?.flashcardMode === "srs"
              ? reviewCount === 0 && newCount === 0
              : entries.length === 0
          }
        />
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
    </View>
  );
}
