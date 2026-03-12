import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  ActivityIndicator,
  Platform,
  RefreshControl,
  SectionList,
  Pressable,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import Encoding from "encoding-japanese";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/BookCard";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Trash2, ExternalLink, Bookmark } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { alert, confirm } from "@/lib/confirm";
import { seedDefaultBookIfNeeded } from "@/lib/seed-default-lists";
import { softDelete } from "@/db/sync-helpers";
import { useSync } from "@/db/sync-provider";
import { SyncChoiceModal } from "@/components/SyncChoiceModal";
import { useAtom } from "jotai";
import { libraryTabAtom } from "@/stores/reader";
import type { Book } from "@/db/types";

const isIOS = Platform.OS === "ios";
const STALE_DAYS = 30;

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
    sourceUrl: row.source_url ?? null,
    imageUrl: row.image_url ?? null,
    saved: row.saved ?? 1,
    readComplete: row.read_complete ?? 0,
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
  const [tab, setTab] = useAtom(libraryTabAtom);

  const loadBooks = useCallback(async () => {
    if (!userDb) return;
    try {
      console.log("[Reader] loadBooks: seeding default book...");
      await seedDefaultBookIfNeeded(userDb);
      console.log("[Reader] loadBooks: querying books...");
      // Load both saved and unsaved (but not deleted)
      const rows = await userDb.getAllAsync<any>(
        "SELECT * FROM books WHERE deleted_at IS NULL ORDER BY last_read_at DESC NULLS LAST, created_at DESC",
      );
      console.log(`[Reader] loadBooks: got ${rows.length} books`);
      setBooks(rows.map(parseBookRow));
    } catch (err) {
      console.error("[Reader] loadBooks FAILED:", err);
    }
  }, [userDb, lastSyncAt]);

  // Auto-cleanup stale unsaved items on focus
  useFocusEffect(
    useCallback(() => {
      if (!userDb) return;
      const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
      userDb.runAsync(
        "DELETE FROM books WHERE saved = 0 AND created_at < ? AND deleted_at IS NULL",
        [cutoff],
      );
      loadBooks();
    }, [userDb, loadBooks]),
  );

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
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        content = await blob.text();
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

  async function handleSave(bookId: string) {
    if (!userDb) return;
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE books SET saved = 1, updated_at = ? WHERE id = ?", [now, bookId]);
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, saved: 1 } : b)));
    triggerSync();
  }

  async function handleUnsave(bookId: string) {
    if (!userDb) return;
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE books SET saved = 0, updated_at = ? WHERE id = ?", [now, bookId]);
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, saved: 0 } : b)));
    triggerSync();
  }

  const isArticleTab = tab === "articles";
  const allItems = useMemo(
    () => books.filter((b) => (isArticleTab ? b.source === "article" : b.source !== "article")),
    [books, isArticleTab],
  );
  const savedItems = useMemo(() => allItems.filter((b) => b.saved === 1), [allItems]);
  const recentItems = useMemo(() => allItems.filter((b) => b.saved === 0), [allItems]);
  const hasRecent = recentItems.length > 0;

  const sections = useMemo(() => {
    if (!hasRecent) {
      // No unsaved items — flat list, no section headers
      return [{ title: "", data: savedItems }];
    }
    const result: { title: string; data: Book[] }[] = [];
    result.push({ title: "Recent", data: recentItems });
    if (savedItems.length > 0) result.push({ title: "Saved", data: savedItems });
    return result;
  }, [hasRecent, recentItems, savedItems]);

  const renderBook = useCallback(
    ({ item }: { item: Book }) => {
      const actions: SwipeAction[] = [];

      // Save / Unsave toggle
      if (item.saved === 0) {
        actions.push({
          label: "Save",
          icon: Bookmark,
          color: "#3b82f6",
          onPress: () => handleSave(item.id),
        });
      }

      if (item.sourceUrl) {
        actions.push({
          label: "Open",
          icon: ExternalLink,
          color: "#6b7280",
          onPress: () => Linking.openURL(item.sourceUrl!),
        });
      }

      actions.push({
        label: "Delete",
        icon: Trash2,
        color: "#ef4444",
        onPress: () => handleDelete(item.id),
      });

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

      {isIOS && (
        <View className="flex-row mx-4 mt-3 mb-1 rounded-lg bg-muted p-0.5">
          <Pressable
            onPress={() => setTab("books")}
            className={`flex-1 items-center py-1.5 rounded-md ${tab === "books" ? "bg-background" : ""}`}
          >
            <Text
              className={`text-sm font-medium ${tab === "books" ? "text-foreground" : "text-muted-foreground"}`}
            >
              Books
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("articles")}
            className={`flex-1 items-center py-1.5 rounded-md ${tab === "articles" ? "bg-background" : ""}`}
          >
            <Text
              className={`text-sm font-medium ${tab === "articles" ? "text-foreground" : "text-muted-foreground"}`}
            >
              Articles
            </Text>
          </Pressable>
        </View>
      )}

      {tab === "books" && (
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
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderBook}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View className="px-4 pt-4 pb-1 bg-background">
              <Text className="text-sm font-semibold text-muted-foreground">{section.title}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          isArticleTab ? (
            <View className="items-center py-16 px-8">
              <Text className="text-muted-foreground text-center">
                No articles yet.{"\n\n"}Share a webpage from Safari using the share button, then tap
                jiten to save it here.
              </Text>
            </View>
          ) : (
            <View className="items-center py-16">
              <Text className="text-muted-foreground text-center">
                No books yet.{"\n"}Browse Aozora Bunko or import a .txt file.
              </Text>
            </View>
          )
        }
        stickySectionHeadersEnabled={false}
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
