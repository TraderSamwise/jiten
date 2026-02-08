import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PitchAccent } from "@/components/PitchAccent";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntry } from "@/db/search";
import { Bookmark } from "@/lib/icons";
import type { DictEntry } from "@/db/types";

export default function WordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { dictDb, isReady } = useDatabase();
  const userDb = useUserDb();
  const navigation = useNavigation();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  useEffect(() => {
    if (!dictDb || !isReady || !id) return;
    getEntry(dictDb, Number(id)).then(setEntry);
  }, [dictDb, isReady, id]);

  const checkBookmarked = useCallback(async () => {
    if (!userDb || !id) return;
    const row = await userDb.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM list_entries WHERE entry_id = ?",
      [Number(id)]
    );
    setIsBookmarked((row?.count ?? 0) > 0);
  }, [userDb, id]);

  useEffect(() => {
    checkBookmarked();
  }, [checkBookmarked]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setPopoverVisible(true)}>
          <Bookmark
            size={22}
            fill={isBookmarked ? "currentColor" : "none"}
            className="text-foreground"
          />
        </Pressable>
      ),
    });
  }, [navigation, isBookmarked]);

  function handlePopoverClose() {
    setPopoverVisible(false);
    checkBookmarked();
  }

  if (!entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16 }}
    >
      <View className="mb-4">
        {entry.kanji.map((k, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <Text className="text-4xl font-bold text-foreground">{k.text}</Text>
            {k.common && <Badge variant="common" label="common" />}
          </View>
        ))}
        <View className="flex-wrap gap-2 mt-2">
          {entry.kana.map((k, i) => {
            const accents = entry.pitchAccents.filter(
              (pa) => pa.reading === k.text
            );
            return (
              <View key={i} className="flex-row items-center gap-1 flex-wrap">
                <Text className="text-xl text-muted-foreground">{k.text}</Text>
                {k.romaji && (
                  <Text className="text-sm text-muted-foreground">
                    ({k.romaji})
                  </Text>
                )}
                {accents.map((pa, j) => (
                  <PitchAccent key={j} accent={pa} />
                ))}
              </View>
            );
          })}
        </View>
      </View>

      <Card className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-2">
          Meanings
        </Text>
        {entry.senses.map((sense, i) => (
          <View key={i} className="mb-3">
            {sense.partOfSpeech.length > 0 && (
              <View className="flex-row flex-wrap gap-1 mb-1">
                {sense.partOfSpeech.map((pos, j) => (
                  <Badge key={j} variant="secondary" label={pos} />
                ))}
              </View>
            )}
            <Text className="text-base text-foreground">
              {i + 1}.{" "}
              {sense.glosses
                .filter((g) => g.lang === "eng")
                .map((g) => g.text)
                .join("; ")}
            </Text>
            {sense.field && (
              <Text className="text-xs text-muted-foreground italic">
                Field: {sense.field}
              </Text>
            )}
            {sense.info && (
              <Text className="text-xs text-muted-foreground">
                {sense.info}
              </Text>
            )}
          </View>
        ))}
      </Card>

      <BookmarkPopover
        visible={popoverVisible}
        onClose={handlePopoverClose}
        entryId={Number(id)}
      />
    </ScrollView>
  );
}
