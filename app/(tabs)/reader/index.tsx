import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, Alert, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/BookCard";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Trash2 } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { parseAozoraToHtml, hasAozoraMarkup, plainTextToHtml } from "@/lib/aozora-parser";
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
    source: row.source ?? "import",
    rawContent: row.raw_content ?? null,
    htmlContent: row.html_content ?? null,
    scrollPosition: row.scroll_position ?? 0,
    fontSize: row.font_size ?? 22,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at ?? null,
  };
}

export { parseBookRow };

export default function LibraryScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBooks = useCallback(async () => {
    if (!userDb) return;
    const rows = await userDb.getAllAsync<any>(
      "SELECT * FROM books ORDER BY last_read_at DESC NULLS LAST, created_at DESC",
    );
    setBooks(rows.map(parseBookRow));
  }, [userDb]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

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
          content = new TextDecoder("shift-jis").decode(buffer);
        }
      } else {
        const { readAsStringAsync, EncodingType } = await import(
          "expo-file-system/legacy"
        );
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
          content = new TextDecoder("shift-jis").decode(bytes);
        }
      }

      const title =
        asset.name?.replace(/\.txt$/i, "") ?? "Imported Book";

      const htmlContent = hasAozoraMarkup(content)
        ? parseAozoraToHtml(content)
        : plainTextToHtml(content);

      const now = new Date().toISOString();
      const id = generateId();

      if (!userDb) return;

      await userDb.runAsync(
        `INSERT INTO books (id, title, author, source, raw_content, html_content, created_at, updated_at)
         VALUES (?, ?, '', 'import', ?, ?, ?, ?)`,
        [id, title, content, htmlContent, now, now],
      );

      setLoading(false);
      await loadBooks();
      router.push(`/reader/${id}`);
    } catch (err) {
      setLoading(false);
      Alert.alert(
        "Import failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  async function handleDelete(bookId: string) {
    if (!userDb) return;
    Alert.alert("Delete book", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await userDb.runAsync("DELETE FROM books WHERE id = ?", [bookId]);
          setBooks((prev) => prev.filter((b) => b.id !== bookId));
        },
      },
    ]);
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
          <BookCard
            book={item}
            onPress={() => router.push(`/reader/${item.id}`)}
          />
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
          label="Browse Aozora"
          variant="outline"
          size="sm"
          onPress={() => router.push("/reader/browse")}
          className="flex-1"
        />
        <Button
          label="Import Text"
          variant="outline"
          size="sm"
          onPress={handleImport}
          className="flex-1"
        />
      </View>

      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        renderItem={renderBook}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-muted-foreground text-center">
              No books yet.{"\n"}Browse Aozora Bunko or import a .txt file.
            </Text>
          </View>
        }
      />
    </View>
  );
}
