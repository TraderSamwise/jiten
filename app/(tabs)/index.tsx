import React, { useCallback, useRef } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { EntryCard } from "@/components/EntryCard";
import { useSearchStore } from "@/stores/search";
import { useDatabase } from "@/db/provider";
import { searchDictionary } from "@/db/search";
import type { DictEntry } from "@/db/types";

export default function SearchScreen() {
  const { dictDb, isReady, isWeb } = useDatabase();
  const { query, results, isSearching, setQuery, setResults, setIsSearching } =
    useSearchStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!text.trim()) {
        setResults([]);
        return;
      }

      setIsSearching(true);
      debounceRef.current = setTimeout(async () => {
        if (!dictDb) return;
        try {
          const entries = await searchDictionary(dictDb, text);
          setResults(entries);
        } catch (err) {
          console.error("Search error:", err);
          setResults([]);
        }
      }, 200);
    },
    [dictDb, setQuery, setResults, setIsSearching]
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
                {isWeb
                  ? "Web preview mode — search requires native build"
                  : "Type to search the dictionary"}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
