import React, { useCallback } from "react";
import { View, Pressable, Platform } from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { CommonActions } from "@react-navigation/native";
import { useSafeGoBack, headerBgClass } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useSearchStore, type SearchMode } from "@/stores/search";
import { useDatabase } from "@/db/provider";
import { ChevronLeft } from "@/lib/icons";

const MODE_LABELS: Record<SearchMode, string> = {
  normal: "文",
  kanji: "漢",
  radical: "部",
  names: "名",
  counter: "数",
};

const MODE_CYCLE: Record<SearchMode, SearchMode> = {
  normal: "kanji",
  kanji: "radical",
  radical: "names",
  names: "counter",
  counter: "normal",
};

const MODE_CYCLE_NO_EXT: Record<SearchMode, SearchMode> = {
  normal: "kanji",
  kanji: "radical",
  radical: "normal",
  names: "normal",
  counter: "normal",
};

const MODE_PLACEHOLDERS: Record<SearchMode, string> = {
  normal: "Search Japanese or English...",
  kanji: "Search kanji by meaning or reading...",
  radical: "",
  names: "Search names...",
  counter: "Search counters...",
};

export function DictionaryHeader({ back, options, route }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const goBack = useSafeGoBack("/dictionary");
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const searchMode = useSearchStore((s) => s.searchMode);
  const setSearchMode = useSearchStore((s) => s.setSearchMode);
  const { extendedDb } = useDatabase();
  const router = useRouter();
  const navigation = useNavigation();
  const isIndex = route.name === "index";

  const popToRoot = useCallback(() => {
    const state = navigation.getState();
    if (!state || state.index === 0) return;
    if (Platform.OS === "web") {
      router.replace("/dictionary" as any);
    } else {
      navigation.dispatch(
        CommonActions.reset({
          ...state,
          index: 0,
          routes: [state.routes[0]],
        }),
      );
    }
  }, [navigation, router]);

  const handleSubmit = () => {
    if (!isIndex && query.trim()) {
      popToRoot();
    }
  };

  const cycleMode = () => {
    const cycle = extendedDb ? MODE_CYCLE : MODE_CYCLE_NO_EXT;
    setSearchMode(cycle[searchMode]);
  };

  const showInput = searchMode !== "radical";

  return (
    <View
      style={{ paddingTop: Platform.OS === "web" ? 3 : insets.top }}
      className={`border-b border-border ${headerBgClass}`}
    >
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        {back && !isIndex && (
          <Pressable onPress={goBack} hitSlop={8} className="py-1">
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
          <View className="flex-1 h-11 justify-center rounded-lg border border-border px-3">
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
