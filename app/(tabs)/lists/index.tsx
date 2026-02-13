import React, { useCallback, useEffect, useState, useRef } from "react";
import { View, FlatList, TextInput, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Pencil, Trash2 } from "@/lib/icons";
import { confirm, alert } from "@/lib/confirm";
import { useUserDb } from "@/db/user-provider";
import { useListsStore, parseListRow } from "@/stores/lists";
import { useBookmarkStore } from "@/stores/bookmarks";
import { parseListImport, importListToDb } from "@/lib/list-transfer";
import type { WordList } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function ListsIndexScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const { lists, setLists, addList, removeList, updateList } = useListsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<TextInput>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!userDb) return;
    loadLists();
  }, [userDb]);

  async function loadLists() {
    if (!userDb) return;
    const rows = await userDb.getAllAsync<WordList & { entryCount: number }>(
      `SELECT l.*, COUNT(le.id) as entryCount
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id
       GROUP BY l.id ORDER BY l.created_at DESC`,
    );
    setLists(rows.map(parseListRow));
  }

  async function handleCreateList() {
    if (!newName.trim() || !userDb) return;
    const now = new Date().toISOString();
    const list: WordList = {
      id: generateId(),
      name: newName.trim(),
      description: null,
      configured: false,
      flashcardMode: "add_order",
      frontFaces: ["kanji"],
      backFaces: ["english"],
      studyPosition: 0,
      autoPlayAudio: false,
      confusionDetection: true,
      voiceMode: false,
      createdAt: now,
      updatedAt: now,
    };
    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [list.id, list.name, list.description, list.createdAt, list.updatedAt],
    );
    addList({ ...list, entryCount: 0 });
    setNewName("");
    setShowCreate(false);
  }

  function handleRenameStart(item: WordList) {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  }

  async function handleRenameSubmit(id: string) {
    if (!renameValue.trim() || !userDb) {
      setRenamingId(null);
      return;
    }
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE lists SET name = ?, updated_at = ? WHERE id = ?", [
      renameValue.trim(),
      now,
      id,
    ]);
    updateList(id, { name: renameValue.trim(), updatedAt: now });
    setRenamingId(null);
  }

  async function doDeleteList(id: string) {
    if (!userDb) return;
    await userDb.runAsync("DELETE FROM srs_cards WHERE list_id = ?", [id]);
    await userDb.runAsync("DELETE FROM list_entries WHERE list_id = ?", [id]);
    await userDb.runAsync("DELETE FROM lists WHERE id = ?", [id]);
    removeList(id);
    await useBookmarkStore.getState().load(userDb);
  }

  async function handleDeleteList(id: string) {
    const ok = await confirm(
      "Delete List",
      "Are you sure? This will also remove associated flashcards.",
    );
    if (!ok) return;
    await doDeleteList(id);
  }

  async function handleImportList() {
    if (!userDb) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", ".jiten", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0];

      let content: string;
      if (Platform.OS === "web") {
        const response = await fetch(asset.uri);
        content = await response.text();
      } else {
        const { readAsStringAsync, EncodingType } = await import("expo-file-system/legacy");
        content = await readAsStringAsync(asset.uri, {
          encoding: EncodingType.UTF8,
        });
      }

      const data = parseListImport(content);

      const hasStudyHistory =
        !!data.studyHistory?.srsCards?.length || !!data.simpleSrsData?.cards?.length;
      let importStudy = false;

      const wordCount = data.entries.length;
      let message = `"${data.list.name}" — ${wordCount} word${wordCount !== 1 ? "s" : ""}`;
      if (hasStudyHistory) {
        message += `\n\nThis file includes study progress. Import it?`;
      }

      const ok = await confirm("Import List", message);
      if (!ok) return;

      if (hasStudyHistory) {
        importStudy = await confirm("Study Progress", "Include SRS cards and review history?");
      }

      setImporting(true);
      try {
        const newListId = await importListToDb(userDb, data, importStudy);

        // Refresh stores
        await loadLists();
        await useBookmarkStore.getState().load(userDb);

        router.push(`/lists/${newListId}`);
      } finally {
        setImporting(false);
      }
    } catch (err) {
      alert("Import Error", String(err instanceof Error ? err.message : err));
    }
  }

  const renderItem = useCallback(
    ({ item }: { item: WordList }) => {
      const actions: SwipeAction[] = [
        {
          label: "Rename",
          icon: Pencil,
          color: "#3b82f6",
          onPress: () => handleRenameStart(item),
        },
        {
          label: "Delete",
          icon: Trash2,
          color: "#ef4444",
          onPress: () => handleDeleteList(item.id),
        },
      ];

      return (
        <SwipeableRow actions={actions}>
          <PressableCard className="mb-2" onPress={() => router.push(`/lists/${item.id}`)}>
            {renamingId === item.id ? (
              <TextInput
                ref={renameInputRef}
                className="text-lg font-semibold text-card-foreground bg-transparent p-0"
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => handleRenameSubmit(item.id)}
                onBlur={() => handleRenameSubmit(item.id)}
                autoFocus
                selectTextOnFocus
              />
            ) : (
              <CardTitle>{item.name}</CardTitle>
            )}
            <CardDescription>{item.entryCount ?? 0} words</CardDescription>
          </PressableCard>
        </SwipeableRow>
      );
    },
    [userDb, renamingId, renameValue, lists],
  );

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
        <Text className="text-lg font-semibold text-foreground">My Lists</Text>
        <View className="flex-row gap-2">
          <Button variant="outline" size="sm" label="Import" onPress={handleImportList} />
          <Button
            variant="outline"
            size="sm"
            label={showCreate ? "Cancel" : "New List"}
            onPress={() => setShowCreate(!showCreate)}
          />
        </View>
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

      {importing && (
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          className="items-center justify-center bg-black/50"
        >
          <View className="rounded-2xl bg-background p-6 items-center">
            <ActivityIndicator size="large" />
            <Text className="mt-3 text-foreground font-medium">Importing...</Text>
          </View>
        </View>
      )}
    </View>
  );
}
