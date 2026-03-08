import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { useUserDb } from "@/db/user-provider";
import { searchBooks, fetchBookContent, getAuthorName, type AozoraBook } from "@/lib/aozora-api";
import { alert } from "@/lib/confirm";
import { useSync } from "@/db/sync-provider";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function BrowseAozoraScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const { triggerSync } = useSync();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AozoraBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const books = await searchBooks(trimmed);
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
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  const handleDownload = useCallback(
    async (aozoraBook: AozoraBook) => {
      if (!userDb) return;

      // Check if already downloaded
      const existing = await userDb.getFirstAsync<any>("SELECT id FROM books WHERE aozora_id = ?", [
        aozoraBook.bookId,
      ]);
      if (existing) {
        router.push(`/reader/${existing.id}`);
        return;
      }

      if (!aozoraBook.xhtmlUrl) {
        alert("Not available", "This book has no download URL.");
        return;
      }

      setDownloading(aozoraBook.bookId);
      try {
        const rawContent = await fetchBookContent(aozoraBook.xhtmlUrl);
        const now = new Date().toISOString();
        const id = generateId();
        const author = getAuthorName(aozoraBook);

        await userDb.runAsync(
          `INSERT INTO books (id, title, author, aozora_id, source, source_id, raw_content, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'aozora', ?, ?, ?, ?)`,
          [
            id,
            aozoraBook.title,
            author,
            aozoraBook.bookId,
            String(aozoraBook.bookId),
            rawContent,
            now,
            now,
          ],
        );

        triggerSync();
        router.push(`/reader/${id}`);
      } catch (err) {
        alert("Download failed", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setDownloading(null);
      }
    },
    [userDb, router, triggerSync],
  );

  const renderItem = useCallback(
    ({ item }: { item: AozoraBook }) => {
      const author = getAuthorName(item);
      const isDownloading = downloading === item.bookId;

      return (
        <PressableCard
          onPress={() => handleDownload(item)}
          className="mb-2"
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
      );
    },
    [downloading, handleDownload],
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
