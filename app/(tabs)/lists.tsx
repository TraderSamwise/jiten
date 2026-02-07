import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, Alert, TextInput } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
import type { WordList } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function ListsScreen() {
  const userDb = useUserDb();
  const { lists, setLists, addList, removeList } = useListsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    loadLists();
  }, []);

  async function loadLists() {
    const rows = await userDb.getAllAsync<WordList & { entryCount: number }>(
      `SELECT l.*, COUNT(le.id) as entryCount
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id
       GROUP BY l.id ORDER BY l.updated_at DESC`
    );
    setLists(rows);
  }

  async function handleCreateList() {
    if (!newName.trim()) return;
    const now = new Date().toISOString();
    const list: WordList = {
      id: generateId(),
      name: newName.trim(),
      description: null,
      createdAt: now,
      updatedAt: now,
    };
    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [list.id, list.name, list.description, list.createdAt, list.updatedAt]
    );
    addList({ ...list, entryCount: 0 });
    setNewName("");
    setShowCreate(false);
  }

  async function handleDeleteList(id: string) {
    Alert.alert(
      "Delete List",
      "Are you sure? This will also remove associated flashcards.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await userDb.runAsync("DELETE FROM lists WHERE id = ?", [id]);
            removeList(id);
          },
        },
      ]
    );
  }

  const renderItem = useCallback(
    ({ item }: { item: WordList }) => (
      <PressableCard
        className="mb-2"
        onPress={() => {
          // TODO: navigate to list detail
        }}
        onLongPress={() => handleDeleteList(item.id)}
      >
        <CardTitle>{item.name}</CardTitle>
        <CardDescription>{item.entryCount ?? 0} words</CardDescription>
      </PressableCard>
    ),
    [userDb]
  );

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
        <Text className="text-lg font-semibold text-foreground">My Lists</Text>
        <Button
          variant="outline"
          size="sm"
          label={showCreate ? "Cancel" : "New List"}
          onPress={() => setShowCreate(!showCreate)}
        />
      </View>

      {showCreate && (
        <View className="flex-row items-center gap-2 px-4 pb-2">
          <TextInput
            className="flex-1 h-10 rounded-lg border border-border bg-background px-3 text-foreground"
            placeholder="List name..."
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={handleCreateList}
            autoFocus
          />
          <Button size="sm" label="Create" onPress={handleCreateList} />
        </View>
      )}

      <Separator />

      <FlatList
        data={lists}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 20,
        }}
        ListEmptyComponent={
          <View className="items-center pt-10">
            <Text className="text-muted-foreground">
              No lists yet. Create one to start collecting words.
            </Text>
          </View>
        }
      />
    </View>
  );
}
