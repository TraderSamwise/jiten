import React, { useCallback, useEffect, useRef } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { EntryCard } from "@/components/EntryCard";
import { useSearchStore } from "@/stores/search";
import { useDatabase } from "@/db/provider";
import { searchDictionary } from "@/db/search";
import type { DictEntry } from "@/db/types";

export default function SearchScreen() {
  const { dictDb, isReady } = useDatabase();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const query = q ?? "";
  const { results, isSearching, setResults, setIsSearching } =
    useSearchStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dictDb || !isReady) return;

    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const entries = await searchDictionary(dictDb, query);
        setResults(entries);
      } catch (err) {
        console.error("Search error:", err);
        setResults([]);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dictDb, isReady, query]);

  const handleSearch = useCallback(
    (text: string) => {
      router.setParams({ q: text || undefined });
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: DictEntry }) => <EntryCard entry={item} />,
    []
  );

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">
          Loading dictionary...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-2 pb-2">
        <Input
          placeholder="Search Japanese or English..."
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {isSearching && (
        <View className="px-4 py-2">
          <ActivityIndicator size="small" />
        </View>
      )}

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          query.trim() && !isSearching ? (
            <View className="items-center pt-10">
              <Text className="text-muted-foreground">No results found</Text>
            </View>
          ) : !query.trim() ? (
            <View className="items-center pt-10">
              <Text className="text-2xl">辞典</Text>
              <Text className="mt-2 text-muted-foreground">
                Type to search the dictionary
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
