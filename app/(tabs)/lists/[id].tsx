import React, { useEffect, useState, useCallback } from "react";
import { View, FlatList } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Text } from "@/components/ui/text";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { ListEntryCard } from "@/components/ListEntryCard";
import { Trash2 } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { getEntries } from "@/db/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import type { DictEntry } from "@/db/types";

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useListsStore((s) => s.lists.find((l) => l.id === id));

  useEffect(() => {
    if (list) {
      navigation.setOptions({ title: list.name });
    }
  }, [list?.name]);

  useEffect(() => {
    loadEntries();
  }, [userDb, dictDb, id]);

  async function loadEntries() {
    if (!userDb || !dictDb || !id) return;
    setLoading(true);

    const rows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ? ORDER BY added_at DESC",
      [id]
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
    await userDb.runAsync(
      "DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?",
      [id, entryId]
    );

    // Remove associated SRS cards for this list
    await userDb.runAsync(
      "DELETE FROM srs_cards WHERE list_id = ? AND entry_id = ?",
      [id, entryId]
    );

    // Check if entry is still in any list
    const remaining = await userDb.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM list_entries WHERE entry_id = ?",
      [entryId]
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
    [userDb, id]
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={entries}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 20,
        }}
        ListEmptyComponent={
          <View className="items-center pt-10">
            <Text className="text-muted-foreground text-center">
              This list is empty.{"\n"}Search for words and add them here.
            </Text>
          </View>
        }
      />
    </View>
  );
}
