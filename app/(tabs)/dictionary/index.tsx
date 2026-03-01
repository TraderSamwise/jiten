import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  SectionList,
  FlatList,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { EntryCard } from "@/components/EntryCard";
import { GlossGroupCard } from "@/components/GlossGroupCard";
import { KanjiCard } from "@/components/KanjiCard";
import { NameCard } from "@/components/NameCard";
import { useSearchStore } from "@/stores/search";
import { useDatabase } from "@/db/provider";
import { searchDictionary } from "@/db/search";
import { searchNames, type NameFilter } from "@/db/name-search";
import {
  searchKanjiByMeaningAsync,
  searchKanjiByReadingAsync,
  searchByRadicalsAsync,
  getAllRadicalsAsync,
  getKanjiAsync,
} from "@/db/kanji-search";
import { groupByGloss } from "@/lib/gloss-groups";
import type { DictEntry, GlossGroup, KanjiCharacter, NameEntry } from "@/db/types";

interface Section {
  title: string;
  type: "words" | "definitions";
  data: (DictEntry | GlossGroup)[];
}

function isSingleKanji(input: string): boolean {
  if ([...input].length !== 1) return false;
  const c = input.codePointAt(0)!;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)
  );
}

function isAsciiInput(input: string): boolean {
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// ─── Radical Mode View ───

function RadicalSearchView() {
  const { dictDb, isReady } = useDatabase();
  const {
    selectedRadicals,
    toggleRadical,
    kanjiResults,
    setKanjiResults,
    isSearching,
    setIsSearching,
  } = useSearchStore();
  const [allRadicals, setAllRadicals] = useState<string[]>([]);

  useEffect(() => {
    if (!dictDb || !isReady) return;
    getAllRadicalsAsync(dictDb)
      .then(setAllRadicals)
      .catch(() => {});
  }, [dictDb, isReady]);

  useEffect(() => {
    if (!dictDb || !isReady) return;

    if (selectedRadicals.length === 0) {
      setKanjiResults([]);
      return;
    }

    setIsSearching(true);
    searchByRadicalsAsync(dictDb, selectedRadicals)
      .then(setKanjiResults)
      .catch(() => setKanjiResults([]));
  }, [dictDb, isReady, selectedRadicals]);

  return (
    <View className="flex-1">
      {/* Radical grid */}
      <ScrollView
        className="max-h-48 border-b border-border"
        contentContainerStyle={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {allRadicals.map((r) => {
          const selected = selectedRadicals.includes(r);
          return (
            <Pressable
              key={r}
              onPress={() => toggleRadical(r)}
              className={`h-9 w-9 items-center justify-center rounded-lg active:opacity-70 ${
                selected ? "bg-primary" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-lg ${selected ? "text-primary-foreground font-bold" : "text-foreground"}`}
              >
                {r}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Results */}
      {isSearching && (
        <View className="absolute inset-0 z-10 items-center justify-center" pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}

      <FlatList
        data={kanjiResults}
        keyExtractor={(item) => item.literal}
        renderItem={({ item }) => <KanjiCard kanji={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 }}
        ListEmptyComponent={
          selectedRadicals.length > 0 && !isSearching ? (
            <View className="items-center pt-10">
              <Text className="text-muted-foreground">No kanji found</Text>
            </View>
          ) : selectedRadicals.length === 0 ? (
            <View className="items-center pt-10">
              <Text className="text-muted-foreground">Select radicals above to search</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ─── Main Screen ───

export default function SearchScreen() {
  const { dictDb, extendedDb, isReady } = useDatabase();
  const {
    query,
    results,
    isSearching,
    setResults,
    setIsSearching,
    setQuery,
    searchMode,
    kanjiResults,
    setKanjiResults,
    nameResults,
    setNameResults,
    nameFilter,
    setNameFilter,
  } = useSearchStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const initializedRef = useRef(false);

  // Seed store from URL query param on mount (for deep links)
  useEffect(() => {
    if (!initializedRef.current && params.q && !query) {
      setQuery(params.q);
    }
    initializedRef.current = true;
  }, []);

  // Normal mode search
  useEffect(() => {
    if (searchMode !== "normal") return;
    if (!dictDb || !isReady) return;

    if (!query.trim()) {
      setResults({ japanese: [], english: [] });
      setIsSearching(false);
      router.setParams({ q: "" });
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++searchGenRef.current;
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchDictionary(dictDb, query, 50, extendedDb);
        if (gen !== searchGenRef.current) return;
        setResults(searchResults);
      } catch (err) {
        if (gen !== searchGenRef.current) return;
        console.error("Search error:", err);
        setResults({ japanese: [], english: [] });
      }
      setIsSearching(false);
      router.setParams(query.trim() ? { q: query.trim() } : { q: "" });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dictDb, extendedDb, isReady, query, searchMode]);

  // Kanji mode search
  useEffect(() => {
    if (searchMode !== "kanji") return;
    if (!dictDb || !isReady) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setKanjiResults([]);
      return;
    }

    // Single kanji → navigate to detail
    if (isSingleKanji(trimmed)) {
      getKanjiAsync(dictDb, trimmed)
        .then((k) => {
          if (k) {
            router.push(`/dictionary/kanji/${encodeURIComponent(trimmed)}`);
          }
        })
        .catch((err) => console.error("Kanji lookup error:", err));
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++searchGenRef.current;
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = isAsciiInput(trimmed)
          ? await searchKanjiByMeaningAsync(dictDb, trimmed)
          : await searchKanjiByReadingAsync(dictDb, trimmed);
        if (gen !== searchGenRef.current) return;
        setKanjiResults(results);
      } catch (err) {
        if (gen !== searchGenRef.current) return;
        console.error("Kanji search error:", err);
        setKanjiResults([]);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dictDb, isReady, query, searchMode]);

  // Names mode search
  useEffect(() => {
    if (searchMode !== "names") return;
    if (!extendedDb || !isReady) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setNameResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++searchGenRef.current;
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchNames(extendedDb, trimmed, 30, nameFilter);
        if (gen !== searchGenRef.current) return;
        setNameResults(results);
      } catch (err) {
        if (gen !== searchGenRef.current) return;
        console.error("Name search error:", err);
        setNameResults([]);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [extendedDb, isReady, query, searchMode, nameFilter]);

  const sections = useMemo<Section[]>(() => {
    if (searchMode !== "normal") return [];
    const s: Section[] = [];
    if (results.englishMatches && results.englishMatches.length > 0) {
      const groups = groupByGloss(results.englishMatches);
      s.push({ title: "Definitions", type: "definitions", data: groups });
    } else if (results.japanese.length > 0) {
      s.push({ title: "Words", type: "words", data: results.japanese });
    }
    return s;
  }, [results, searchMode]);

  const hasBothSections = sections.length > 1;

  const renderItem = useCallback(
    ({ item, section }: { item: DictEntry | GlossGroup; section: Section }) => {
      if (section.type === "definitions") {
        return <GlossGroupCard group={item as GlossGroup} />;
      }
      return <EntryCard entry={item as DictEntry} />;
    },
    [],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => {
      if (!hasBothSections) return null;
      return (
        <View className="pb-1 pt-3 px-1 bg-background">
          <Text className="text-sm font-medium text-muted-foreground">{section.title}</Text>
        </View>
      );
    },
    [hasBothSections],
  );

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading dictionary...</Text>
      </View>
    );
  }

  // Radical mode
  if (searchMode === "radical") {
    return (
      <View className="flex-1 bg-background">
        <RadicalSearchView />
      </View>
    );
  }

  // Kanji mode
  if (searchMode === "kanji") {
    return (
      <View className="flex-1 bg-background">
        {isSearching && (
          <View className="absolute inset-0 z-10 items-center justify-center" pointerEvents="none">
            <ActivityIndicator size="large" />
          </View>
        )}

        <FlatList
          data={kanjiResults}
          keyExtractor={(item) => item.literal}
          renderItem={({ item }) => <KanjiCard kanji={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 }}
          ListEmptyComponent={
            query.trim() && !isSearching ? (
              <View className="items-center pt-10">
                <Text className="text-muted-foreground">No kanji found</Text>
              </View>
            ) : !query.trim() ? (
              <View className="items-center pt-10">
                <Text className="text-2xl">漢字</Text>
                <Text className="mt-2 text-muted-foreground">
                  Search by English meaning or Japanese reading
                </Text>
              </View>
            ) : null
          }
        />
      </View>
    );
  }

  // Names mode
  if (searchMode === "names") {
    const filterChips: { key: NameFilter; label: string }[] = [
      { key: "all", label: "All" },
      { key: "person", label: "People" },
      { key: "place", label: "Places" },
    ];

    return (
      <View className="flex-1 bg-background">
        {isSearching && (
          <View className="absolute inset-0 z-10 items-center justify-center" pointerEvents="none">
            <ActivityIndicator size="large" />
          </View>
        )}

        {/* Filter chips */}
        <View className="flex-row gap-2 px-4 pt-2 pb-1">
          {filterChips.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setNameFilter(key)}
              className={`rounded-full px-3 py-1 active:opacity-70 ${
                nameFilter === key ? "bg-primary" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  nameFilter === key ? "text-primary-foreground" : "text-foreground"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={nameResults}
          keyExtractor={(item) => `${item.id}`}
          renderItem={({ item }) => <NameCard name={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 }}
          ListEmptyComponent={
            query.trim() && !isSearching ? (
              <View className="items-center pt-10">
                <Text className="text-muted-foreground">No names found</Text>
              </View>
            ) : !query.trim() ? (
              <View className="items-center pt-10">
                <Text className="text-2xl">名前</Text>
                <Text className="mt-2 text-muted-foreground">Search Japanese names</Text>
              </View>
            ) : null
          }
        />
      </View>
    );
  }

  // Normal mode
  return (
    <View className="flex-1 bg-background">
      {isSearching && (
        <View className="absolute inset-0 z-10 items-center justify-center" pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item, index) => {
          if ("gloss" in item) return `gloss-${item.gloss}-${index}`;
          return `${(item as DictEntry).id}-${index}`;
        }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          query.trim() && !isSearching ? (
            <View className="items-center pt-10">
              <Text className="text-muted-foreground">No results found</Text>
            </View>
          ) : !query.trim() ? (
            <View className="items-center pt-10">
              <Text className="text-2xl">辞典</Text>
              <Text className="mt-2 text-muted-foreground">Type to search the dictionary</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
