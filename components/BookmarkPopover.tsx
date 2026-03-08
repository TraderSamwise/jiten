import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Modal, Pressable, View, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useUserDb } from "@/db/user-provider";
import { useListsStore, parseListRow } from "@/stores/lists";
import { Plus, Check, FolderOpen } from "@/lib/icons";
import {
  generateId,
  addEntryToList,
  removeEntryFromList,
  addKanjiToList,
  removeKanjiFromList,
} from "@/lib/quick-bookmark";
import { useSync } from "@/db/sync-provider";
import type { WordList } from "@/db/types";

interface BookmarkPopoverProps {
  visible: boolean;
  onClose: () => void;
  entryId?: number;
  kanjiLiteral?: string;
  anchorPosition?: { top: number; right: number };
  onListToggled?: (listId: string, added: boolean) => void;
}

export function BookmarkPopover({
  visible,
  onClose,
  entryId,
  kanjiLiteral,
  anchorPosition,
  onListToggled,
}: BookmarkPopoverProps) {
  const insets = useSafeAreaInsets();
  // Remember last valid anchor so the popover doesn't snap during fade-out
  const lastAnchorRef = useRef(anchorPosition);
  if (anchorPosition) lastAnchorRef.current = anchorPosition;
  const pos = anchorPosition ?? lastAnchorRef.current ?? { top: insets.top + 44, right: 8 };
  const userDb = useUserDb();
  const addListToStore = useListsStore((s) => s.addList);
  const { markDirty } = useSync();
  const [lists, setLists] = useState<WordList[]>([]);
  const [membershipMap, setMembershipMap] = useState<Set<string>>(new Set());
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [popoverHeight, setPopoverHeight] = useState(0);

  const isKanji = kanjiLiteral != null;

  useEffect(() => {
    if (!visible || !userDb) return;
    loadData();
  }, [visible, userDb]);

  async function loadData() {
    if (!userDb) return;
    const allLists = await userDb.getAllAsync<WordList>(
      "SELECT * FROM lists WHERE is_default = 0 AND deleted_at IS NULL ORDER BY name",
    );
    setLists(allLists.map(parseListRow));

    if (isKanji) {
      const memberships = await userDb.getAllAsync<{ list_id: string }>(
        "SELECT list_id FROM list_entries WHERE kanji_literal = ? AND deleted_at IS NULL",
        [kanjiLiteral],
      );
      setMembershipMap(new Set(memberships.map((m: { list_id: string }) => m.list_id)));
    } else if (entryId != null) {
      const memberships = await userDb.getAllAsync<{ list_id: string }>(
        "SELECT list_id FROM list_entries WHERE entry_id = ? AND kanji_literal IS NULL AND deleted_at IS NULL",
        [entryId],
      );
      setMembershipMap(new Set(memberships.map((m: { list_id: string }) => m.list_id)));
    }
  }

  async function toggleList(listId: string) {
    if (!userDb) return;

    if (membershipMap.has(listId)) {
      // Remove
      if (isKanji) {
        await removeKanjiFromList(userDb, kanjiLiteral!, listId);
      } else if (entryId != null) {
        await removeEntryFromList(userDb, entryId, listId);
      }
      const newMap = new Set(membershipMap);
      newMap.delete(listId);
      setMembershipMap(newMap);
      onListToggled?.(listId, false);
    } else {
      // Add
      if (isKanji) {
        await addKanjiToList(userDb, kanjiLiteral!, listId);
      } else if (entryId != null) {
        await addEntryToList(userDb, entryId, listId);
      }
      setMembershipMap((prev) => new Set(prev).add(listId));
      onListToggled?.(listId, true);
    }
    markDirty();
  }

  async function handleCreateList() {
    if (!newListName.trim() || !userDb) return;
    const now = new Date().toISOString();
    const list: WordList = {
      id: generateId(),
      name: newListName.trim(),
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
      learningSteps: null,
      relearningSteps: null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [list.id, list.name, list.description, list.createdAt, list.updatedAt],
    );
    addListToStore({ ...list, entryCount: 0 });
    setLists((prev) => [...prev, list].sort((a, b) => a.name.localeCompare(b.name)));
    setNewListName("");
    setShowNewList(false);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose}>
        {/* Popover content */}
        <Pressable
          onPress={() => {}}
          onLayout={(e) => setPopoverHeight(e.nativeEvent.layout.height)}
          style={(() => {
            const screenH = Dimensions.get("window").height;
            const fitsBelow = pos.top + popoverHeight + 8 < screenH;
            if (fitsBelow || popoverHeight === 0) {
              return { top: pos.top, right: pos.right };
            }
            // Render upward: bottom = screenH - pos.top + gap
            return { bottom: screenH - pos.top + 8, right: pos.right };
          })()}
          className="absolute w-64 rounded-xl border border-border bg-background shadow-lg"
        >
          {/* New List row */}
          {showNewList ? (
            <View className="flex-row items-center gap-2 px-3 py-2 border-b border-border">
              <TextInput
                className="flex-1 h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                placeholder="List name..."
                placeholderTextColor="#999"
                value={newListName}
                onChangeText={setNewListName}
                onSubmitEditing={handleCreateList}
                autoFocus
              />
              <Pressable onPress={handleCreateList} className="px-2 py-1">
                <Text className="text-sm font-medium text-primary">Create</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowNewList(true)}
              className="flex-row items-center gap-2 px-3 py-3 border-b border-border"
            >
              <Plus size={16} className="text-primary" />
              <Text className="text-sm font-medium text-primary">New List...</Text>
            </Pressable>
          )}

          {/* List items */}
          {lists.map((list) => {
            const isMember = membershipMap.has(list.id);
            return (
              <Pressable
                key={list.id}
                onPress={() => toggleList(list.id)}
                className="flex-row items-center gap-2 px-3 py-3"
              >
                <FolderOpen size={16} className="text-muted-foreground" />
                <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                  {list.name}
                </Text>
                {isMember && <Check size={16} className="text-primary" />}
              </Pressable>
            );
          })}

          {lists.length === 0 && (
            <View className="px-3 py-4">
              <Text className="text-sm text-muted-foreground text-center">No lists yet</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
