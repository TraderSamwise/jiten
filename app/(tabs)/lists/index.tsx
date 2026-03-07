import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, ScrollView, Pressable, TextInput, Platform, InteractionManager } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Pencil, Trash2, ChevronDown, BarChart3 } from "@/lib/icons";
import { confirm, alert } from "@/lib/confirm";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { useListsStore, parseListRow } from "@/stores/lists";
import { useBookmarkStore } from "@/stores/bookmarks";
import { parseListImport, importListToDb } from "@/lib/list-transfer";
import { StudyProgressBar } from "@/components/ProgressBar";
import { seedDefaultListsIfNeeded } from "@/lib/seed-default-lists";
import { softDelete } from "@/db/sync-helpers";
import { useSync } from "@/db/sync-provider";
import type { WordList } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function ListsIndexScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const lists = useListsStore((s) => s.lists);
  const listsLoaded = useListsStore((s) => s.listsLoaded);
  const setLists = useListsStore((s) => s.setLists);
  const addList = useListsStore((s) => s.addList);
  const removeList = useListsStore((s) => s.removeList);
  const updateList = useListsStore((s) => s.updateList);
  const { triggerSync } = useSync();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<TextInput>(null);
  const [importing, setImporting] = useState<number | null>(null);
  const [defaultsExpanded, setDefaultsExpanded] = useState(false);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const animatedMaxHeight = useSharedValue(0);
  const chevronRotation = useSharedValue(0);

  const defaultListCount = lists.filter((l) => l.isDefault).length;
  // Slightly generous estimate — each card is ~76px, pad a bit for progress bars
  const expandedMaxHeight = 8 + defaultListCount * 80;

  const toggleDefaults = useCallback(() => {
    const next = !defaultsExpanded;
    setDefaultsExpanded(next);
    chevronRotation.value = withTiming(next ? 180 : 0, { duration: 250 });
    if (next) {
      if (!defaultsReady) setDefaultsReady(true);
      animatedMaxHeight.value = withTiming(expandedMaxHeight, { duration: 250 });
    } else {
      animatedMaxHeight.value = withTiming(0, { duration: 250 });
    }
  }, [defaultsExpanded, defaultsReady, expandedMaxHeight]);

  const animatedContainerStyle = useAnimatedStyle(() => ({
    maxHeight: animatedMaxHeight.value,
    overflow: "hidden" as const,
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  useEffect(() => {
    if (!userDb) return;

    // If lists are already cached, defer refresh to after transition
    const run = async () => {
      if (dictDb) {
        try {
          const seeded = await seedDefaultListsIfNeeded(userDb, dictDb);
          if (seeded) await useBookmarkStore.getState().load(userDb);
        } catch (err) {
          console.warn("[Lists] Seeding error (non-fatal):", err);
        }
      }
      await loadLists();
    };

    if (listsLoaded) {
      // Already have cached data — refresh silently after transition
      const task = InteractionManager.runAfterInteractions(run);
      return () => task.cancel();
    } else {
      // First load — defer until after transition animation
      const task = InteractionManager.runAfterInteractions(run);
      return () => task.cancel();
    }
  }, [userDb, dictDb]);

  async function loadLists() {
    if (!userDb) return;
    const rows = await userDb.getAllAsync<WordList & { entryCount: number }>(
      `SELECT l.*, COUNT(le.id) as entryCount
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id AND le.deleted_at IS NULL
       WHERE l.deleted_at IS NULL
       GROUP BY l.id ORDER BY l.created_at DESC`,
    );

    // Fetch SRS progress counts per list (handles both FSRS and simple_srs modes)
    type SrsProgress = { list_id: string; total: number; learned: number; learning: number };
    const srsRows = await userDb.getAllAsync<SrsProgress>(
      `SELECT list_id,
        COUNT(*) as total,
        SUM(CASE WHEN state = 2 OR simple_stage = 1 THEN 1 ELSE 0 END) as learned,
        SUM(CASE WHEN state IN (1, 3) OR simple_stage = 0 THEN 1 ELSE 0 END) as learning
       FROM srs_cards
       WHERE deleted_at IS NULL
       GROUP BY list_id`,
    );
    const srsMap = new Map<string, SrsProgress>(srsRows.map((r: SrsProgress) => [r.list_id, r]));

    setLists(
      rows.map((row: WordList & { entryCount: number }) => {
        const parsed = parseListRow(row);
        const srs = srsMap.get(parsed.id);
        if (srs) {
          // Has SRS cards — use SRS counts
          parsed.studyProgress = {
            learned: srs.learned,
            learning: srs.learning,
            unlearned: (parsed.entryCount ?? 0) - srs.learned - srs.learning,
          };
        } else if (
          parsed.configured &&
          parsed.flashcardMode === "add_order" &&
          parsed.studyPosition > 0
        ) {
          // Add-order mode with progress — derive from study_position
          parsed.studyProgress = {
            learned: parsed.studyPosition,
            learning: 0,
            unlearned: (parsed.entryCount ?? 0) - parsed.studyPosition,
          };
        }
        return parsed;
      }),
    );
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
      typingMode: false,
      disableFlipAnimation: false,
      disableSwipeAnimation: false,
      isDefault: false,
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
    triggerSync();
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
    await softDelete(userDb, "srs_cards", "list_id = ?", [id]);
    await softDelete(userDb, "list_entries", "list_id = ?", [id]);
    await softDelete(userDb, "lists", "id = ?", [id]);
    removeList(id);
    useListsStore.getState().clearScrollCache(id);
    await useBookmarkStore.getState().load(userDb);
    triggerSync();
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

      setImporting(0);
      try {
        const newListId = await importListToDb(userDb, data, importStudy, setImporting);

        // Refresh stores
        await loadLists();
        await useBookmarkStore.getState().load(userDb);
        triggerSync(true);

        router.push(`/lists/${newListId}`);
      } finally {
        setImporting(null);
      }
    } catch (err) {
      alert("Import Error", String(err instanceof Error ? err.message : err));
    }
  }

  const customLists = lists.filter((l) => !l.isDefault);
  const defaultLists = lists.filter((l) => l.isDefault);

  function renderListCard(item: WordList) {
    const card = (
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
        <View className="flex-row items-center justify-between">
          <CardDescription>{item.entryCount ?? 0} words</CardDescription>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              router.push(`/lists/stats?listId=${item.id}`);
            }}
            className="p-1 -mr-1"
            hitSlop={8}
          >
            <BarChart3 size={14} className="text-muted-foreground" />
          </Pressable>
        </View>
        {item.studyProgress &&
          (item.studyProgress.learned > 0 || item.studyProgress.learning > 0) && (
            <StudyProgressBar
              learned={item.studyProgress.learned}
              learning={item.studyProgress.learning}
              total={item.entryCount ?? 0}
            />
          )}
      </PressableCard>
    );

    if (item.isDefault) return <React.Fragment key={item.id}>{card}</React.Fragment>;

    return (
      <SwipeableRow
        key={item.id}
        actions={[
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
        ]}
      >
        {card}
      </SwipeableRow>
    );
  }

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

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 20,
        }}
      >
        {customLists.length === 0 && defaultLists.length === 0 && (
          <View className="items-center pt-10">
            <Text className="text-muted-foreground">
              No lists yet. Create one to start collecting words.
            </Text>
          </View>
        )}

        {customLists.map(renderListCard)}

        {defaultLists.length > 0 && (
          <View className="mt-4">
            <Pressable
              onPress={toggleDefaults}
              className="flex-row items-center justify-between rounded-lg bg-muted/50 px-3 py-3"
            >
              <Text className="text-sm font-semibold text-muted-foreground">
                Default Lists ({defaultLists.length})
              </Text>
              <Animated.View style={chevronStyle}>
                <ChevronDown size={16} className="text-muted-foreground" />
              </Animated.View>
            </Pressable>

            {defaultsReady && (
              <Animated.View style={animatedContainerStyle}>
                <View className="pt-2">{defaultLists.map(renderListCard)}</View>
              </Animated.View>
            )}
          </View>
        )}
      </ScrollView>

      {importing !== null && (
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          className="items-center justify-center"
        >
          <View className="rounded-2xl bg-background p-6 items-center w-64">
            <View className="w-full h-2 bg-secondary rounded-full mb-2 overflow-hidden">
              <View
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.round(importing * 100)}%` }}
              />
            </View>
            <Text className="text-foreground font-medium">
              Importing... {Math.round(importing * 100)}%
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
