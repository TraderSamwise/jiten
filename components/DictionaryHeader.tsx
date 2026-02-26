import React from "react";
import { View, Pressable, Platform } from "react-native";
import { useSafeGoBack } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useSearchStore, type SearchMode } from "@/stores/search";
import { ChevronLeft } from "@/lib/icons";

const MODE_LABELS: Record<SearchMode, string> = {
  normal: "文",
  kanji: "漢",
  radical: "部",
};

const MODE_CYCLE: Record<SearchMode, SearchMode> = {
  normal: "kanji",
  kanji: "radical",
  radical: "normal",
};

const MODE_PLACEHOLDERS: Record<SearchMode, string> = {
  normal: "Search Japanese or English...",
  kanji: "Search kanji by meaning or reading...",
  radical: "",
};

export function DictionaryHeader({ back, options, route }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const goBack = useSafeGoBack("/dictionary");
  const { query, setQuery, searchMode, setSearchMode } = useSearchStore();
  const isWordDetail = route.name === "word/[id]" || route.name === "gloss-group";
  const isKanjiDetail = route.name === "kanji/[literal]";

  const navigateToSearch = () => goBack();

  const handleSubmit = () => {
    if ((isWordDetail || isKanjiDetail) && query.trim()) {
      navigateToSearch();
    }
  };

  const cycleMode = () => {
    setSearchMode(MODE_CYCLE[searchMode]);
  };

  const showInput = searchMode !== "radical";

  return (
    <View style={{ paddingTop: insets.top }} className="bg-background border-b border-border">
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        {back && (
          <Pressable onPress={navigateToSearch} hitSlop={8} className="py-1">
            <ChevronLeft size={24} className="text-primary" />
          </Pressable>
        )}

        {showInput ? (
          <Input
            className="flex-1"
            placeholder={MODE_PLACEHOLDERS[searchMode]}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            {...(Platform.OS === "web" && {
              enterKeyHint: "search" as any,
            })}
          />
        ) : (
          <View className="flex-1 h-10 justify-center">
            <Text className="text-muted-foreground">Tap radicals to filter kanji</Text>
          </View>
        )}

        <Pressable
          onPress={cycleMode}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-lg bg-secondary active:opacity-70"
        >
          <Text className="text-lg font-bold text-foreground">{MODE_LABELS[searchMode]}</Text>
        </Pressable>

        {options.headerRight?.({ canGoBack: !!back, tintColor: undefined })}
      </View>
    </View>
  );
}
