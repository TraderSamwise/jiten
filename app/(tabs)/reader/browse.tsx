import React, { useCallback, useState } from "react";
import { View, FlatList, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import {
  PressableCard,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useUserDb } from "@/db/user-provider";
import {
  searchBooks,
  fetchBookContent,
  getAuthorName,
  type AozoraBook,
} from "@/lib/aozora-api";
import { parseAozoraToHtml } from "@/lib/aozora-parser";
import { parseBookRow } from "./index";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function BrowseAozoraScreen() {
  const router = useRouter();
  const userDb = useUserDb();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AozoraBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const books = await searchBooks(q);
      setResults(books);
    } catch (err) {
      Alert.alert(
        "Search failed",
        err instanceof Error ? err.message : "Network error",
      );
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleDownload = useCallback(
    async (aozoraBook: AozoraBook) => {
      if (!userDb) return;

      // Check if already downloaded
      const existing = await userDb.getFirstAsync<any>(
        "SELECT id FROM books WHERE aozora_id = ?",
        [aozoraBook.bookId],
      );
      if (existing) {
        router.push(`/reader/${existing.id}`);
        return;
      }

      if (!aozoraBook.textUrl) {
        Alert.alert("Not available", "This book has no text download URL.");
        return;
      }

      setDownloading(aozoraBook.bookId);
      try {
        const rawContent = await fetchBookContent(aozoraBook.textUrl);
        const htmlContent = parseAozoraToHtml(rawContent);
        const now = new Date().toISOString();
        const id = generateId();
        const author = getAuthorName(aozoraBook);

        await userDb.runAsync(
          `INSERT INTO books (id, title, author, aozora_id, source, raw_content, html_content, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'aozora', ?, ?, ?, ?)`,
          [
            id,
            aozoraBook.title,
            author,
            aozoraBook.bookId,
            rawContent,
            htmlContent,
            now,
            now,
          ],
        );

        router.push(`/reader/${id}`);
      } catch (err) {
        Alert.alert(
          "Download failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        setDownloading(null);
      }
    },
    [userDb, router],
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
              {author ? (
                <CardDescription numberOfLines={1}>
                  {author}
                </CardDescription>
              ) : null}
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
          onSubmitEditing={handleSearch}
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
