import React, { useState } from "react";
import { Modal, Pressable, Platform, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUserDb } from "@/db/user-provider";
import { useSync } from "@/db/sync-provider";
import { resetLocalUserData } from "@/db/sync-helpers";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useListsStore } from "@/stores/lists";
import { alert } from "@/lib/confirm";

interface HardSyncModalProps {
  visible: boolean;
  onClose: () => void;
}

export function HardSyncModal({ visible, onClose }: HardSyncModalProps) {
  const userDb = useUserDb();
  const { triggerSync } = useSync();
  const [syncing, setSyncing] = useState(false);

  async function handleHardSync() {
    if (!userDb) return;
    setSyncing(true);
    try {
      await resetLocalUserData(userDb);
      useBookmarkStore.getState().load(userDb);
      useListsStore.getState().load(userDb);
      await triggerSync(true);
      onClose();
    } catch (err) {
      alert("Hard Sync Failed", String(err));
    } finally {
      setSyncing(false);
    }
  }

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
            <Text className="text-lg font-semibold text-foreground mb-2">Hard Sync</Text>
            <Text className="text-sm text-muted-foreground mb-4">
              This will delete all local data and re-download everything from the cloud. Default
              study lists will be re-created. Local-only changes that haven{"'"}t been synced will
              be lost.
            </Text>

            <View className="flex-row gap-2">
              <Button className="flex-1" variant="outline" label="Cancel" onPress={onClose} />
              <Button
                className="flex-1"
                variant="destructive"
                label={syncing ? "Syncing..." : "Hard Sync"}
                onPress={handleHardSync}
                disabled={syncing}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
