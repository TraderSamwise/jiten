import React from "react";
import { View, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Input } from "@/components/ui/input";
import { useSearchStore } from "@/stores/search";
import { ChevronLeft } from "@/lib/icons";

export function DictionaryHeader({
  back,
  options,
  route,
}: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { query, setQuery } = useSearchStore();
  const isWordDetail = route.name === "word/[id]";

  const handleSubmit = () => {
    if (isWordDetail && query.trim()) {
      router.back();
    }
  };

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="bg-background border-b border-border"
    >
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        {back && (
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="py-1"
          >
            <ChevronLeft size={24} className="text-primary" />
          </Pressable>
        )}

        <Input
          className="flex-1"
          placeholder="Search Japanese or English..."
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

        {options.headerRight?.({ canGoBack: !!back, tintColor: undefined })}
      </View>
    </View>
  );
}
