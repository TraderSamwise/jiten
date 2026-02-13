import React, { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUserDb } from "@/db/user-provider";
import { buildListExport } from "@/lib/list-transfer";
import { saveAndShareFile } from "@/lib/file-transfer";
import { alert } from "@/lib/confirm";

interface ExportListModalProps {
  visible: boolean;
  onClose: () => void;
  listId: string;
  listName: string;
}

export function ExportListModal({ visible, onClose, listId, listName }: ExportListModalProps) {
  const userDb = useUserDb();
  const [includeStudy, setIncludeStudy] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!userDb) return;
    setExporting(true);
    try {
      const data = await buildListExport(userDb, listId, includeStudy);
      const json = JSON.stringify(data, null, 2);
      const filename = `${listName.replace(/[^a-zA-Z0-9_\-\u3000-\u9fff\u4e00-\u9faf]/g, "_")}.jiten`;
      await saveAndShareFile(filename, json, "application/json");
      onClose();
    } catch (err) {
      alert("Export Error", String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          className="bg-black/50"
          onPress={onClose}
        />

        <View className="flex-1 justify-center px-6">
          <View className="rounded-2xl border border-border bg-background p-5">
            <Text className="text-lg font-semibold text-foreground mb-1">Export List</Text>
            <Text className="text-sm text-muted-foreground mb-4">{listName}</Text>

            {/* Include study progress toggle */}
            <Text className="text-sm font-medium text-muted-foreground mb-2">
              Include study progress
            </Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setIncludeStudy(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  !includeStudy ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    !includeStudy ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  No
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setIncludeStudy(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${
                  includeStudy ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    includeStudy ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Yes
                </Text>
              </Pressable>
            </View>

            {/* Actions */}
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="outline" label="Cancel" onPress={onClose} />
              <Button
                className="flex-1"
                label={exporting ? "Exporting..." : "Export"}
                onPress={handleExport}
                disabled={exporting}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
