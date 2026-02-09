import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, SectionList, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { EntryCard } from "@/components/EntryCard";
import { useSearchStore } from "@/stores/search";
import { useDatabase } from "@/db/provider";
import { searchDictionary } from "@/db/search";
import type { DictEntry } from "@/db/types";

interface Section {
  title: string;
  data: DictEntry[];
}

export default function SearchScreen() {
  const { dictDb, isReady } = useDatabase();
  const { query, results, isSearching, setResults, setIsSearching } =
    useSearchStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dictDb || !isReady) return;

    if (!query.trim()) {
      setResults({ japanese: [], english: [] });
      return;
    }

    setIsSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const searchResults = await searchDictionary(dictDb, query);
        setResults(searchResults);
      } catch (err) {
        console.error("Search error:", err);
        setResults({ japanese: [], english: [] });
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dictDb, isReady, query]);

  const sections = useMemo<Section[]>(() => {
    const s: Section[] = [];
    if (results.japanese.length > 0) {
      s.push({ title: "Words", data: results.japanese });
    }
    if (results.english.length > 0) {
      s.push({ title: "Definitions", data: results.english });
    }
    return s;
  }, [results]);

  const hasBothSections = sections.length > 1;

  const renderItem = useCallback(
    ({ item }: { item: DictEntry }) => <EntryCard entry={item} />,
    []
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => {
      if (!hasBothSections) return null;
      return (
        <View className="pb-1 pt-3 px-1 bg-background">
          <Text className="text-sm font-medium text-muted-foreground">
            {section.title}
          </Text>
        </View>
      );
    },
    [hasBothSections]
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
      {isSearching && (
        <View className="px-4 py-2">
          <ActivityIndicator size="small" />
        </View>
      )}

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        stickySectionHeadersEnabled={false}
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
