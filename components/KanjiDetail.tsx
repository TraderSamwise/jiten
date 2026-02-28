import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { useSearchStore } from "@/stores/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmarkKanji } from "@/hooks/useQuickBookmark";
import {
  getKanjiAsync,
  getSimilarKanjiAsync,
  getSimilarByMeaningAsync,
  getRadicalsForKanjiAsync,
} from "@/db/kanji-search";
import { getWordsForKanjiAsync } from "@/db/search";
import { EntryCard } from "@/components/EntryCard";
import type { KanjiCharacter, SimilarKanji, DictEntry } from "@/db/types";

interface KanjiDetailProps {
  literal: string;
}

export function KanjiDetail({ literal }: KanjiDetailProps) {
  const { dictDb, isReady } = useDatabase();
  const router = useRouter();
  const { setSearchMode, setSelectedRadicals } = useSearchStore();
  const [kanji, setKanji] = useState<KanjiCharacter | null>(null);
  const [similar, setSimilar] = useState<SimilarKanji[]>([]);
  const [similarMeaning, setSimilarMeaning] = useState<KanjiCharacter[]>([]);
  const [radicals, setRadicals] = useState<string[]>([]);
  const [words, setWords] = useState<DictEntry[]>([]);

  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`k:${literal}`));
  const { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled } =
    useQuickBookmarkKanji(literal, isBookmarked);

  useEffect(() => {
    if (!dictDb || !isReady || !literal) return;

    getKanjiAsync(dictDb, literal)
      .then(setKanji)
      .catch(() => {});
    getSimilarKanjiAsync(dictDb, literal)
      .then(setSimilar)
      .catch(() => {});
    getSimilarByMeaningAsync(dictDb, literal)
      .then(setSimilarMeaning)
      .catch((e) => console.warn("similarMeaning query failed:", e));
    getRadicalsForKanjiAsync(dictDb, literal)
      .then(setRadicals)
      .catch(() => {});
    getWordsForKanjiAsync(dictDb, literal)
      .then(setWords)
      .catch(() => {});
  }, [dictDb, isReady, literal]);

  const handleRadicalPress = (radical: string) => {
    setSearchMode("radical");
    setSelectedRadicals([radical]);
    router.push("/dictionary");
  };

  const handleSimilarPress = (similarLiteral: string) => {
    router.push(`/dictionary/kanji/${encodeURIComponent(similarLiteral)}`);
  };

  const handleKoohiiPress = (character: string) => {
    Linking.openURL(`https://kanji.koohii.com/study/kanji/${encodeURIComponent(character)}`);
  };

  if (!kanji) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16 }}>
      {/* Header */}
      <View className="items-center mb-6">
        <View className="flex-row justify-end w-full mb-2">
          <Pressable onPress={handlePress} onLongPress={handleLongPress} className="p-1">
            <Bookmark
              size={22}
              fill={isBookmarked ? "currentColor" : "none"}
              className="text-foreground"
            />
          </Pressable>
        </View>
        <Text className="text-7xl font-bold text-foreground leading-tight">{kanji.literal}</Text>
        {kanji.heisigKeyword && (
          <Text className="text-lg text-muted-foreground mt-1">{kanji.heisigKeyword}</Text>
        )}
        <View className="flex-row flex-wrap justify-center gap-2 mt-3">
          {kanji.grade != null && <Badge variant="secondary" label={`Grade ${kanji.grade}`} />}
          {kanji.jlptLevel != null && <Badge variant="secondary" label={`N${kanji.jlptLevel}`} />}
          <Badge variant="outline" label={`${kanji.strokeCount} strokes`} />
          {kanji.frequencyRank != null && (
            <Badge variant="outline" label={`#${kanji.frequencyRank}`} />
          )}
          {kanji.heisigIndex != null && (
            <Badge variant="outline" label={`Heisig ${kanji.heisigIndex}`} />
          )}
        </View>
        {kanji.heisigIndex != null && (
          <Button
            variant="outline"
            size="sm"
            label="Study on Koohii"
            onPress={() => handleKoohiiPress(kanji.literal)}
            className="mt-3"
          />
        )}
      </View>

      {/* Readings */}
      <Card className="mb-3">
        <Text className="text-sm font-medium text-muted-foreground mb-2">Readings</Text>
        {kanji.readingsOn.length > 0 && (
          <View className="mb-1.5">
            <Text className="text-xs text-muted-foreground">ON'yomi</Text>
            <Text className="text-base text-foreground">{kanji.readingsOn.join("、")}</Text>
          </View>
        )}
        {kanji.readingsKun.length > 0 && (
          <View className="mb-1.5">
            <Text className="text-xs text-muted-foreground">KUN'yomi</Text>
            <Text className="text-base text-foreground">{kanji.readingsKun.join("、")}</Text>
          </View>
        )}
        {kanji.nanori.length > 0 && (
          <View>
            <Text className="text-xs text-muted-foreground">Nanori</Text>
            <Text className="text-base text-foreground">{kanji.nanori.join("、")}</Text>
          </View>
        )}
      </Card>

      {/* Meanings */}
      {kanji.meanings.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Meanings</Text>
          {kanji.meanings.map((m, i) => (
            <Text key={i} className="text-base text-foreground">
              {m}
            </Text>
          ))}
        </Card>
      )}

      {/* Radicals */}
      {radicals.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Radicals</Text>
          <View className="flex-row flex-wrap gap-2">
            {radicals.map((r) => (
              <Pressable
                key={r}
                onPress={() => handleRadicalPress(r)}
                className="h-9 w-9 items-center justify-center rounded-lg bg-secondary active:opacity-70"
              >
                <Text className="text-lg text-foreground">{r}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {/* Similar Visually */}
      {similar.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Similar Visually</Text>
          <View className="flex-row flex-wrap gap-2">
            {similar.map((s) => (
              <Pressable
                key={s.literal}
                onPress={() => handleSimilarPress(s.literal)}
                className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
              >
                <Text className="text-xl font-bold text-foreground">{s.literal}</Text>
                <Text className="text-xs text-muted-foreground">{Math.round(s.score * 100)}%</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {/* Similar Meaning */}
      {similarMeaning.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Similar Meaning</Text>
          <View className="flex-row flex-wrap gap-2">
            {similarMeaning.map((k) => (
              <Pressable
                key={k.literal}
                onPress={() => handleSimilarPress(k.literal)}
                className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
              >
                <Text className="text-xl font-bold text-foreground">{k.literal}</Text>
                <Text className="text-xs text-muted-foreground">{k.meanings[0] ?? ""}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {/* Words */}
      {words.length > 0 && (
        <View className="mb-6">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Words</Text>
          {words.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </View>
      )}

      <BookmarkPopover
        visible={popoverVisible}
        onClose={dismissPopover}
        kanjiLiteral={literal}
        onListToggled={onListToggled}
      />
    </ScrollView>
  );
}
