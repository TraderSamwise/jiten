import React, { useState } from "react";
import { Modal, Pressable, Platform, Switch, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useUserDb } from "@/db/user-provider";
import { useSync } from "@/db/sync-provider";
import { DATA_CATEGORIES, deleteSelectedData } from "@/db/sync-helpers";
import { useBookmarkStore } from "@/stores/bookmarks";
import { confirm, alert } from "@/lib/confirm";
import { setLastUser } from "@/lib/last-user";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CATEGORY_KEYS = Object.keys(DATA_CATEGORIES);

interface DeleteDataModalProps {
  visible: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  deleteAccount?: () => Promise<void>;
}

export function DeleteDataModal({
  visible,
  onClose,
  isSignedIn,
  deleteAccount,
}: DeleteDataModalProps) {
  const userDb = useUserDb();
  const { tursoClient, triggerSync } = useSync();
  const [selected, setSelected] = useState<Set<string>>(new Set(CATEGORY_KEYS));
  const [deleteAcc, setDeleteAcc] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const allDataSelected = CATEGORY_KEYS.every((k) => selected.has(k));

  function toggleCategory(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (allDataSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(CATEGORY_KEYS));
    }
  }

  async function handleDelete() {
    if (!userDb) return;
    if (selected.size === 0 && !deleteAcc) return;

    const isAccountDelete = deleteAcc && isSignedIn && deleteAccount;
    const label = isAccountDelete
      ? "This will permanently delete your account and all data. This cannot be undone."
      : "This will delete the selected data. This cannot be undone.";

    const proceed = await confirm(isAccountDelete ? "Delete Account?" : "Delete Data?", label);
    if (!proceed) return;

    setDeleting(true);
    try {
      // Delete selected data categories
      if (selected.size > 0) {
        await deleteSelectedData(userDb, tursoClient, selected);
        // Reload bookmark store after deletions
        useBookmarkStore.getState().load(userDb);
        // Sync soft-deletes to remote
        if (tursoClient) {
          await triggerSync(true);
        }
      }

      // Delete account if requested
      if (isAccountDelete) {
        // Delete all remaining data first
        if (selected.size < CATEGORY_KEYS.length) {
          await deleteSelectedData(userDb, tursoClient, new Set(CATEGORY_KEYS));
        }
        await AsyncStorage.removeItem("last_signed_in_user");
        await deleteAccount!();
      }

      onClose();
    } catch (err) {
      alert("Delete Error", String(err));
    } finally {
      setDeleting(false);
    }
  }

  const buttonLabel = deleting
    ? "Deleting..."
    : deleteAcc && isSignedIn
      ? "Delete Account"
      : "Delete";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View
            className="rounded-2xl border border-border bg-background p-5"
            style={
              Platform.OS === "web"
                ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Text className="text-lg font-semibold text-foreground mb-4">Delete Data</Text>

            {/* Select All */}
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm font-medium text-foreground">Select All</Text>
              <Switch value={allDataSelected} onValueChange={toggleAll} />
            </View>

            <Separator className="my-1" />

            {/* Data categories */}
            {CATEGORY_KEYS.map((key) => (
              <View key={key} className="flex-row items-center justify-between py-2">
                <Text className="text-sm text-foreground">{DATA_CATEGORIES[key].label}</Text>
                <Switch value={selected.has(key)} onValueChange={() => toggleCategory(key)} />
              </View>
            ))}

            {/* Delete Account section (signed-in only) */}
            {isSignedIn && deleteAccount && (
              <>
                <Separator className="my-2" />
                <View className="flex-row items-center justify-between py-2">
                  <View className="flex-1 mr-3">
                    <Text className="text-sm text-foreground">Delete Account</Text>
                    <Text className="text-xs text-muted-foreground">
                      Permanently deletes your account and all cloud data.
                    </Text>
                  </View>
                  <Switch value={deleteAcc} onValueChange={setDeleteAcc} />
                </View>
              </>
            )}

            {/* Actions */}
            <View className="flex-row gap-2 mt-4">
              <Button className="flex-1" variant="outline" label="Cancel" onPress={onClose} />
              <Button
                className="flex-1"
                variant="destructive"
                label={buttonLabel}
                onPress={handleDelete}
                disabled={deleting || (selected.size === 0 && !deleteAcc)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
