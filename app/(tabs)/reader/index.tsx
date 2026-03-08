import React, { useCallback, useState } from "react";
import { View, ActivityIndicator, Platform, RefreshControl } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import Encoding from "encoding-japanese";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/BookCard";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Trash2 } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { alert, confirm } from "@/lib/confirm";
import { seedDefaultBookIfNeeded } from "@/lib/seed-default-lists";
import { softDelete } from "@/db/sync-helpers";
import { useSync } from "@/db/sync-provider";
import { SyncChoiceModal } from "@/components/SyncChoiceModal";
import type { Book } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function parseBookRow(row: any): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? "",
    aozoraId: row.aozora_id ?? null,
    sourceId: row.source_id ?? null,
    source: row.source ?? "import",
    rawContent: row.raw_content ?? null,
    htmlContent: row.html_content ?? null,
    scrollPosition: row.scroll_position ?? 0,
    charOffset: row.char_offset ?? 0,
    totalChars: row.total_chars ?? 0,
    fontSize: row.font_size ?? 22,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at ?? null,
    saved: row.saved ?? 1,
  };
}

export { parseBookRow };

export default function LibraryScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const { triggerSync, isDirty, syncWithChoice, syncStatus, lastSyncAt } = useSync();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSyncChoice, setShowSyncChoice] = useState(false);

  const loadBooks = useCallback(async () => {
    if (!userDb) return;
    await seedDefaultBookIfNeeded(userDb);
    const rows = await userDb.getAllAsync<any>(
      "SELECT * FROM books WHERE deleted_at IS NULL AND saved = 1 ORDER BY last_read_at DESC NULLS LAST, created_at DESC",
    );
    setBooks(rows.map(parseBookRow));
  }, [userDb, lastSyncAt]);

  const handleRefresh = useCallback(async () => {
    if (syncStatus === "disabled") {
      await loadBooks();
      return;
    }
    if (isDirty) {
      setShowSyncChoice(true);
      return;
    }
    setRefreshing(true);
    await triggerSync();
    await loadBooks();
    setRefreshing(false);
  }, [syncStatus, isDirty, triggerSync, loadBooks]);

  const handleSyncChoice = useCallback(
    async (choice: "merge" | "use-cloud" | "use-local") => {
      setShowSyncChoice(false);
      setRefreshing(true);
      await syncWithChoice(choice);
      await loadBooks();
      setRefreshing(false);
    },
    [syncWithChoice, loadBooks],
  );

  useFocusEffect(
    useCallback(() => {
      loadBooks();
    }, [loadBooks]),
  );

  async function handleImport() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "text/plain",
        copyToCacheDirectory: true,
      });

      if (result.canceled || result.assets.length === 0) return;

      setLoading(true);
      const asset = result.assets[0];

      let content: string;
      if (Platform.OS === "web") {
        // On web, fetch the blob URI and read as text
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        content = await blob.text();
        // If content looks garbled (common with SJIS), try SJIS decode
        if (content.includes("\ufffd")) {
          const buffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          const unicodeArray = Encoding.convert(uint8, { to: "UNICODE", from: "SJIS" });
          content = Encoding.codeToString(unicodeArray);
        }
      } else {
        const { readAsStringAsync, EncodingType } = await import("expo-file-system/legacy");
        try {
          content = await readAsStringAsync(asset.uri, {
            encoding: EncodingType.UTF8,
          });
        } catch {
          // Try reading as binary and attempting SJIS decode
          const base64 = await readAsStringAsync(asset.uri, {
            encoding: EncodingType.Base64,
          });
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const unicodeArray = Encoding.convert(bytes, { to: "UNICODE", from: "SJIS" });
          content = Encoding.codeToString(unicodeArray);
        }
      }

      const title = asset.name?.replace(/\.txt$/i, "") ?? "Imported Book";
      const now = new Date().toISOString();
      const id = generateId();

      if (!userDb) return;

      await userDb.runAsync(
        `INSERT INTO books (id, title, author, source, raw_content, created_at, updated_at)
         VALUES (?, ?, '', 'import', ?, ?, ?)`,
        [id, title, content, now, now],
      );

      setLoading(false);
      await loadBooks();
      triggerSync();
      router.push(`/reader/${id}`);
    } catch (err) {
      setLoading(false);
      alert("Import failed", err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDelete(bookId: string) {
    if (!userDb) return;
    const ok = await confirm("Delete book", "Are you sure?");
    if (!ok) return;
    await softDelete(userDb, "books", "id = ?", [bookId]);
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    triggerSync();
  }

  const renderBook = useCallback(
    ({ item }: { item: Book }) => {
      const actions: SwipeAction[] = [
        {
          label: "Delete",
          icon: Trash2,
          color: "#ef4444",
          onPress: () => handleDelete(item.id),
        },
      ];

      return (
        <SwipeableRow actions={actions}>
          <BookCard book={item} onPress={() => router.push(`/reader/${item.id}`)} />
        </SwipeableRow>
      );
    },
    [userDb],
  );

  return (
    <View className="flex-1 bg-background">
      {loading && (
        <View className="absolute inset-0 z-10 items-center justify-center bg-background/80">
          <ActivityIndicator size="large" />
          <Text className="mt-2 text-muted-foreground">Importing...</Text>
        </View>
      )}

      <View className="flex-row gap-2 px-4 py-3">
        <Button
          label="Aozora"
          variant="outline"
          size="sm"
          onPress={() => router.push("/reader/browse")}
          className="flex-1"
        />
        <Button
          label="Syosetu"
          variant="outline"
          size="sm"
          onPress={() => router.push("/reader/browse-syosetu")}
          className="flex-1"
        />
        <Button
          label="Import"
          variant="outline"
          size="sm"
          onPress={handleImport}
          className="flex-1"
        />
      </View>

      <FlashList
        data={books}
        keyExtractor={(item) => item.id}
        renderItem={renderBook}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-muted-foreground text-center">
              No books yet.{"\n"}Browse Aozora Bunko or import a .txt file.
            </Text>
          </View>
        }
      />

      <SyncChoiceModal
        visible={showSyncChoice}
        onChoice={handleSyncChoice}
        title="Unsaved Local Changes"
        description="You have local changes that haven't been synced yet. How should we handle the refresh?"
      />
    </View>
  );
}
