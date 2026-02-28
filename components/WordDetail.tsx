import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PitchAccent } from "@/components/PitchAccent";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { PlayAudioButton } from "@/components/PlayAudioButton";
import { useDatabase } from "@/db/provider";
import { getEntry } from "@/db/search";
import { Bookmark } from "@/lib/icons";
import { shouldDeEmphasize, shouldHide, getTagLabel } from "@/lib/tags";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmark } from "@/hooks/useQuickBookmark";
import type { DictEntry } from "@/db/types";

function isKanji(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

interface WordDetailProps {
  entryId: number;
}

export function WordDetail({ entryId }: WordDetailProps) {
  const { dictDb, isReady } = useDatabase();
  const navigation = useNavigation();
  const router = useRouter();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`e:${entryId}`));
  const { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled } =
    useQuickBookmark(entryId, isBookmarked);

  useEffect(() => {
    if (!dictDb || !isReady || !entryId) return;
    getEntry(dictDb, entryId).then(setEntry);
  }, [dictDb, isReady, entryId]);

  useEffect(() => {
    navigation.setOptions({ headerRight: () => null });
  }, [navigation]);

  if (!entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16 }}>
      <View className="flex-row justify-end items-center gap-2 mb-1">
        <PlayAudioButton entryId={entryId} size={22} />
        <Pressable onPress={handlePress} onLongPress={handleLongPress} className="p-1">
          <Bookmark
            size={22}
            fill={isBookmarked ? "currentColor" : "none"}
            className="text-foreground"
          />
        </Pressable>
      </View>

      <View
        className={
          isBookmarked ? "mb-4 rounded-lg border-l-4 border-primary bg-primary/5 pl-3 py-2" : "mb-4"
        }
      >
        {entry.kanji
          .filter((k) => !shouldHide(k.tags))
          .map((k, i) => {
            const muted = shouldDeEmphasize(k.tags);
            return (
              <View key={i} className="flex-row items-center gap-2">
                <Text
                  className={
                    muted ? "text-2xl text-muted-foreground" : "text-4xl font-bold text-foreground"
                  }
                >
                  {muted
                    ? k.text
                    : [...k.text].map((ch, ci) =>
                        isKanji(ch.codePointAt(0)!) ? (
                          <Text
                            key={ci}
                            className="text-4xl font-bold text-foreground"
                            onPress={() =>
                              router.push(`/dictionary/kanji/${encodeURIComponent(ch)}`)
                            }
                          >
                            {ch}
                          </Text>
                        ) : (
                          ch
                        ),
                      )}
                </Text>
                {k.common && <Badge variant="common" label="common" />}
                {k.tags.map((t, j) => (
                  <Badge key={j} variant="outline" label={getTagLabel(t)} />
                ))}
              </View>
            );
          })}
        <View className="flex-wrap gap-2 mt-2">
          {entry.kana.map((k, i) => {
            const muted = shouldDeEmphasize(k.tags);
            const accents = entry.pitchAccents.filter((pa) => pa.reading === k.text);
            return (
              <View key={i} className="flex-row items-center gap-1 flex-wrap">
                <Text
                  className={
                    muted ? "text-base text-muted-foreground/50" : "text-xl text-muted-foreground"
                  }
                >
                  {k.text}
                </Text>
                {k.romaji && (
                  <Text
                    className={
                      muted ? "text-xs text-muted-foreground/50" : "text-sm text-muted-foreground"
                    }
                  >
                    ({k.romaji})
                  </Text>
                )}
                {!muted && accents.map((pa, j) => <PitchAccent key={j} accent={pa} />)}
                {k.tags.map((t, j) => (
                  <Badge key={j} variant="outline" label={getTagLabel(t)} />
                ))}
              </View>
            );
          })}
        </View>
        {entry.jlptLevel != null && (
          <View className="flex-row gap-1 mt-1">
            <Badge variant="secondary" label={`JLPT N${entry.jlptLevel}`} />
          </View>
        )}
      </View>

      <Card className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-2">Meanings</Text>
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
              <Text className="text-xs text-muted-foreground italic">Field: {sense.field}</Text>
            )}
            {sense.info && <Text className="text-xs text-muted-foreground">{sense.info}</Text>}
          </View>
        ))}
      </Card>

      <BookmarkPopover
        visible={popoverVisible}
        onClose={dismissPopover}
        entryId={entryId}
        onListToggled={onListToggled}
      />
    </ScrollView>
  );
}
