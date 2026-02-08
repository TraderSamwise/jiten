import React, { useEffect, useState } from "react";
import { Modal, Pressable, View, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useUserDb } from "@/db/user-provider";
import { useListsStore } from "@/stores/lists";
import { createNewCard } from "@/stores/srs";
import { Plus, Check, FolderOpen } from "@/lib/icons";
import type { WordList } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

interface BookmarkPopoverProps {
  visible: boolean;
  onClose: () => void;
  entryId: number;
}

export function BookmarkPopover({
  visible,
  onClose,
  entryId,
}: BookmarkPopoverProps) {
  const insets = useSafeAreaInsets();
  const userDb = useUserDb();
  const addListToStore = useListsStore((s) => s.addList);
  const [lists, setLists] = useState<WordList[]>([]);
  const [membershipMap, setMembershipMap] = useState<Set<string>>(new Set());
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState("");

  useEffect(() => {
    if (!visible || !userDb) return;
    loadData();
  }, [visible, userDb]);

  async function loadData() {
    if (!userDb) return;
    const allLists = await userDb.getAllAsync<WordList>(
      "SELECT * FROM lists ORDER BY name"
    );
    setLists(allLists);

    const memberships = await userDb.getAllAsync<{ list_id: string }>(
      "SELECT list_id FROM list_entries WHERE entry_id = ?",
      [entryId]
    );
    setMembershipMap(new Set(memberships.map((m: { list_id: string }) => m.list_id)));
  }

  async function toggleList(listId: string) {
    if (!userDb) return;
    const now = new Date().toISOString();

    if (membershipMap.has(listId)) {
      await userDb.runAsync(
        "DELETE FROM list_entries WHERE list_id = ? AND entry_id = ?",
        [listId, entryId]
      );
      await userDb.runAsync(
        "DELETE FROM srs_cards WHERE entry_id = ? AND list_id = ?",
        [entryId, listId]
      );
      setMembershipMap((prev) => {
        const next = new Set(prev);
        next.delete(listId);
        return next;
      });
    } else {
      await userDb.runAsync(
        "INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, ?, ?)",
        [generateId(), listId, entryId, now]
      );

      const card = createNewCard();
      await userDb.runAsync(
        `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty,
          elapsed_days, scheduled_days, reps, lapses, state, last_review,
          front_mode, back_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(),
          entryId,
          listId,
          card.due.toISOString(),
          card.stability,
          card.difficulty,
          card.elapsed_days,
          card.scheduled_days,
          card.reps,
          card.lapses,
          card.state,
          card.last_review?.toISOString() ?? null,
          "kanji",
          "english",
          now,
          now,
        ]
      );
      setMembershipMap((prev) => new Set(prev).add(listId));
    }
  }

  async function handleCreateList() {
    if (!newListName.trim() || !userDb) return;
    const now = new Date().toISOString();
    const list: WordList = {
      id: generateId(),
      name: newListName.trim(),
      description: null,
      createdAt: now,
      updatedAt: now,
    };
    await userDb.runAsync(
      "INSERT INTO lists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [list.id, list.name, list.description, list.createdAt, list.updatedAt]
    );
    addListToStore({ ...list, entryCount: 0 });
    setLists((prev) => [...prev, list].sort((a, b) => a.name.localeCompare(b.name)));
    setNewListName("");
    setShowNewList(false);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1">
        {/* Backdrop — sibling so it doesn't swallow child presses */}
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />

        {/* Popover content */}
        <View
          style={{ top: insets.top + 44, right: 8 }}
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
                <Text className="text-sm font-medium text-primary">
                  Create
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowNewList(true)}
              className="flex-row items-center gap-2 px-3 py-3 border-b border-border"
            >
              <Plus size={16} className="text-primary" />
              <Text className="text-sm font-medium text-primary">
                New List...
              </Text>
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
                <Text
                  className="flex-1 text-sm text-foreground"
                  numberOfLines={1}
                >
                  {list.name}
                </Text>
                {isMember && (
                  <Check size={16} className="text-primary" />
                )}
              </Pressable>
            );
          })}

          {lists.length === 0 && (
            <View className="px-3 py-4">
              <Text className="text-sm text-muted-foreground text-center">
                No lists yet
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
