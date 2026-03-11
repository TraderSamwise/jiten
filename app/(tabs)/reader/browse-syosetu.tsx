import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { searchNovels, type SyosetuNovel } from "@/lib/syosetu-api";
import { alert } from "@/lib/confirm";

// Module-level cache so results survive remounts (back navigation)
let cachedQuery = "";
let cachedResults: SyosetuNovel[] = [];

export default function BrowseSyosetuScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQ = params.q ?? "";
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<SyosetuNovel[]>(
    initialQ && initialQ === cachedQuery ? cachedResults : [],
  );
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      router.setParams(trimmed ? { q: trimmed } : { q: "" });
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
        const novels = await searchNovels(trimmed);
        cachedQuery = trimmed;
        cachedResults = novels;
        setResults(novels);
      } catch (err) {
        alert("Search failed", err instanceof Error ? err.message : "Network error");
      } finally {
        setSearching(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  const handleNovelPress = useCallback(
    (novel: SyosetuNovel) => {
      router.push(
        `/reader/novel-syosetu?ncode=${novel.ncode}&title=${encodeURIComponent(novel.title)}&writer=${encodeURIComponent(novel.writer)}`,
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: SyosetuNovel }) => {
      const status = item.isComplete ? "Complete" : "Ongoing";
      const chapters = `${item.totalChapters} chapters`;

      return (
        <PressableCard onPress={() => handleNovelPress(item)} className="mb-2">
          <View className="flex-1">
            <CardTitle numberOfLines={2}>{item.title}</CardTitle>
            <CardDescription numberOfLines={1}>
              {item.writer} · {chapters} · {status}
            </CardDescription>
          </View>
        </PressableCard>
      );
    },
    [handleNovelPress],
  );

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <Input
          placeholder="Search novels..."
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoFocus
        />
      </View>

      <FlashList
        data={results}
        keyExtractor={(item) => item.ncode}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListHeaderComponent={
          searching ? (
            <View className="items-center py-8">
              <ActivityIndicator size="large" />
              <Text className="mt-2 text-muted-foreground">Searching...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !searching ? (
            <View className="items-center py-16">
              <Text className="text-muted-foreground text-center">
                Search Syosetu (小説家になろう) for web novels.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
