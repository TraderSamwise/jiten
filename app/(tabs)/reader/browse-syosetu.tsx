import React, { useCallback, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { searchNovels, type SyosetuNovel } from "@/lib/syosetu-api";
import { alert } from "@/lib/confirm";

export default function BrowseSyosetuScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SyosetuNovel[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const novels = await searchNovels(q);
      setResults(novels);
    } catch (err) {
      alert("Search failed", err instanceof Error ? err.message : "Network error");
    } finally {
      setSearching(false);
    }
  }, [query]);

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
        keyExtractor={(item) => item.ncode}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16 }}
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
