import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Download, Trash2 } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { searchBooks, fetchBookContent, getAuthorName, type AozoraBook } from "@/lib/aozora-api";
import { alert } from "@/lib/confirm";
import { useSync } from "@/db/sync-provider";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// Module-level cache so results survive remounts (back navigation)
let cachedQuery = "";
let cachedResults: AozoraBook[] = [];

type ImportStatus = { id: string; saved: number };

export default function BrowseAozoraScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const userDb = useUserDb();
  const { triggerSync } = useSync();
  const initialQ = params.q ?? "";
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<AozoraBook[]>(
    initialQ && initialQ === cachedQuery ? cachedResults : [],
  );
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importMap, setImportMap] = useState<Map<number, ImportStatus>>(new Map());

  // Refresh import status for current results
  const refreshImportStatus = useCallback(
    async (books: AozoraBook[]) => {
      if (!userDb || books.length === 0) {
        setImportMap(new Map());
        return;
      }
      const ids = books.map((b) => b.bookId);
      const placeholders = ids.map(() => "?").join(",");
      const rows = await userDb.getAllAsync<{ id: string; aozora_id: number; saved: number }>(
        `SELECT id, aozora_id, saved FROM books WHERE aozora_id IN (${placeholders}) AND deleted_at IS NULL`,
        ids,
      );
      const map = new Map<number, ImportStatus>();
      for (const row of rows) {
        map.set(row.aozora_id, { id: row.id, saved: row.saved });
      }
      setImportMap(map);
    },
    [userDb],
  );

  // Refresh import status when results change
  useEffect(() => {
    refreshImportStatus(results);
  }, [results, refreshImportStatus]);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      cachedQuery = "";
      cachedResults = [];
      return;
    }
    if (trimmed === cachedQuery && cachedResults.length > 0) {
      setResults(cachedResults);
      return;
    }
    setSearching(true);
    try {
      const books = await searchBooks(trimmed);
      cachedQuery = trimmed;
      cachedResults = books;
      setResults(books);
    } catch (err) {
      alert("Search failed", err instanceof Error ? err.message : "Network error");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 400);
    router.setParams(query.trim() ? { q: query.trim() } : { q: "" });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch, router]);

  async function downloadAndInsert(aozoraBook: AozoraBook, saved: number): Promise<string | null> {
    if (!userDb) return null;
    if (!aozoraBook.xhtmlUrl) {
      alert("Not available", "This book has no download URL.");
      return null;
    }

    setDownloading(aozoraBook.bookId);
    try {
      const rawContent = await fetchBookContent(aozoraBook.xhtmlUrl);
      const now = new Date().toISOString();
      const id = generateId();
      const author = getAuthorName(aozoraBook);

      await userDb.runAsync(
        `INSERT INTO books (id, title, author, aozora_id, source, source_id, raw_content, saved, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'aozora', ?, ?, ?, ?, ?)`,
        [
          id,
          aozoraBook.title,
          author,
          aozoraBook.bookId,
          String(aozoraBook.bookId),
          rawContent,
          saved,
          now,
          now,
        ],
      );

      // Evict oldest unsaved books beyond cap
      if (saved === 0) {
        await userDb.runAsync(
          `DELETE FROM books WHERE saved = 0 AND deleted_at IS NULL AND source != 'article'
           AND id NOT IN (SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source != 'article' ORDER BY created_at DESC LIMIT 10)`,
          [],
        );
      }

      triggerSync();
      setImportMap((prev) => new Map(prev).set(aozoraBook.bookId, { id, saved }));
      return id;
    } catch (err) {
      alert("Download failed", err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setDownloading(null);
    }
  }

  const handleCardPress = useCallback(
    async (aozoraBook: AozoraBook) => {
      if (!userDb) return;

      const status = importMap.get(aozoraBook.bookId);
      if (status) {
        // Already in DB — navigate to reader
        router.push(`/reader/${status.id}`);
        return;
      }

      // Not in DB — download as preview (saved=0) and navigate
      const id = await downloadAndInsert(aozoraBook, 0);
      if (id) router.push(`/reader/${id}`);
    },
    [userDb, router, importMap],
  );

  const handleImport = useCallback(
    async (aozoraBook: AozoraBook) => {
      if (!userDb) return;

      const status = importMap.get(aozoraBook.bookId);
      if (status) {
        // Already in DB with saved=0, set saved=1
        const now = new Date().toISOString();
        await userDb.runAsync("UPDATE books SET saved = 1, updated_at = ? WHERE id = ?", [
          now,
          status.id,
        ]);
        triggerSync();
        setImportMap((prev) => new Map(prev).set(aozoraBook.bookId, { ...status, saved: 1 }));
      } else {
        // Not in DB — download with saved=1
        await downloadAndInsert(aozoraBook, 1);
      }
    },
    [userDb, importMap, triggerSync],
  );

  const handleRemove = useCallback(
    async (aozoraBook: AozoraBook) => {
      if (!userDb) return;
      const status = importMap.get(aozoraBook.bookId);
      if (!status) return;

      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE books SET saved = 0, updated_at = ? WHERE id = ?", [
        now,
        status.id,
      ]);
      triggerSync();
      setImportMap((prev) => new Map(prev).set(aozoraBook.bookId, { ...status, saved: 0 }));
    },
    [userDb, importMap, triggerSync],
  );

  const renderItem = useCallback(
    ({ item }: { item: AozoraBook }) => {
      const author = getAuthorName(item);
      const isDownloading = downloading === item.bookId;
      const status = importMap.get(item.bookId);

      const actions: SwipeAction[] =
        status?.saved === 1
          ? [{ label: "Remove", icon: Trash2, color: "#ef4444", onPress: () => handleRemove(item) }]
          : [
              {
                label: "Import",
                icon: Download,
                color: "#3b82f6",
                onPress: () => handleImport(item),
              },
            ];

      return (
        <SwipeableRow actions={actions}>
          <PressableCard
            onPress={() => handleCardPress(item)}
            className={`mb-2 ${status?.saved === 1 ? "bg-primary/5" : ""}`}
            disabled={isDownloading}
          >
            <View className="flex-row items-center">
              <View className="flex-1">
                <CardTitle numberOfLines={2}>{item.title}</CardTitle>
                {author ? <CardDescription numberOfLines={1}>{author}</CardDescription> : null}
              </View>
              {isDownloading && <ActivityIndicator className="ml-2" />}
            </View>
          </PressableCard>
        </SwipeableRow>
      );
    },
    [downloading, handleCardPress, handleImport, handleRemove, importMap],
  );

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <Input
          placeholder="Search title or author..."
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoFocus
        />
      </View>

      {searching && (
        <View className="items-center py-8">
          <ActivityIndicator size="large" />
          <Text className="mt-2 text-muted-foreground">Searching...</Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.bookId)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={
          !searching ? (
            <View className="items-center py-16">
              <Text className="text-muted-foreground text-center">
                Search Aozora Bunko for free Japanese ebooks.{"\n"}
                Try "吾輩は猫である" or "夏目漱石"
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
