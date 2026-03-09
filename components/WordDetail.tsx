import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Linking,
  Platform,
  InteractionManager,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useNavigation } from "expo-router";
import { useTabRouter } from "@/lib/navigation";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PitchAccent } from "@/components/PitchAccent";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { PlayAudioButton } from "@/components/PlayAudioButton";
import { useDatabase } from "@/db/provider";
import { getEntry } from "@/db/search";
import { Bookmark } from "@/lib/icons";
import { useAtomValue } from "jotai";
import { showRomajiAtom } from "@/stores/settings";
import { shouldDeEmphasize, shouldHide, getTagLabel } from "@/lib/tags";
import { japaneseFontStyle } from "@/lib/japanese-font";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmark } from "@/hooks/useQuickBookmark";
import { decomposeWord, type LookupResult } from "@/lib/smart-lookup";
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
  const tabRouter = useTabRouter();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const showRomaji = useAtomValue(showRomajiAtom);
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`e:${entryId}`));
  const { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled } =
    useQuickBookmark(entryId, isBookmarked);
  const bookmarkRef = useRef<View>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<
    { top: number; right: number } | undefined
  >();
  const [wordParts, setWordParts] = useState<LookupResult[]>([]);

  function measureAndRun(callback: () => void) {
    bookmarkRef.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get("window").width;
      setBookmarkAnchor({ top: y + height + 4, right: screenWidth - x - width });
      callback();
    });
  }

  useEffect(() => {
    if (!dictDb || !isReady || !entryId) return;
    const task = InteractionManager.runAfterInteractions(() => {
      getEntry(dictDb, entryId).then(setEntry);
    });
    return () => task.cancel();
  }, [dictDb, isReady, entryId]);

  // Decompose compound word into sub-words
  useEffect(() => {
    if (!dictDb || !entry) {
      setWordParts([]);
      return;
    }
    const word = entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
    let cancelled = false;
    decomposeWord(word, dictDb).then((parts) => {
      if (!cancelled) setWordParts(parts);
    });
    return () => {
      cancelled = true;
    };
  }, [dictDb, entry]);

  useEffect(() => {
    navigation.setOptions({ headerRight: () => null });
  }, [navigation]);

  // Entry not found after loading completes — may be unavailable in mini DB
  if (!entry && dictDb && isReady) {
    return (
      <View className="flex-1 items-center justify-center p-6 bg-background">
        <Text className="text-lg text-muted-foreground text-center">
          This entry will be available after the full dictionary downloads.
        </Text>
      </View>
    );
  }

  if (!entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading entry...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16 }}>
      <View className="flex-row justify-end items-center gap-2 mb-1">
        <PlayAudioButton entryId={entryId} size={22} />
        <Pressable
          ref={bookmarkRef}
          onPress={() => measureAndRun(handlePress)}
          onLongPress={() => measureAndRun(handleLongPress)}
          className="p-1"
        >
          <Bookmark
            size={22}
            className={isBookmarked ? "text-foreground fill-foreground" : "text-foreground"}
          />
        </Pressable>
      </View>

      <View
        className={
          isBookmarked ? "mb-4 rounded-lg border-l-4 border-primary bg-primary/5 pl-3 py-2" : "mb-4"
        }
      >
        {entry.jlptLevel != null && (
          <Text className="absolute top-2 right-3 text-xs font-semibold text-muted-foreground">
            JLPT N{entry.jlptLevel}
          </Text>
        )}
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
                            onPress={() => tabRouter.pushKanji(ch)}
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
                {!muted && accents.length > 0 ? (
                  accents.map((pa, j) => <PitchAccent key={j} accent={pa} fontSize={20} />)
                ) : (
                  <Text
                    className={
                      muted ? "text-base text-muted-foreground/50" : "text-xl text-muted-foreground"
                    }
                  >
                    {k.text}
                  </Text>
                )}
                {showRomaji && k.romaji && (
                  <Text
                    className={
                      muted ? "text-xs text-muted-foreground/50" : "text-sm text-muted-foreground"
                    }
                  >
                    ({k.romaji})
                  </Text>
                )}
                {k.tags.map((t, j) => (
                  <Badge key={j} variant="outline" label={getTagLabel(t)} />
                ))}
              </View>
            );
          })}
        </View>
      </View>

      <Card className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-2">Meanings</Text>
        {entry.senses.map((sense, i) => (
          <View key={i} className="mb-3">
            <Text className="text-base text-foreground">
              {i + 1}.{" "}
              {sense.partOfSpeech.length > 0 && (
                <Text className="text-xs text-muted-foreground italic">
                  {sense.partOfSpeech.join(", ")}
                  {"   "}
                </Text>
              )}
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

      {wordParts.length > 0 && (
        <Card className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-2">Word Parts</Text>
          <View className="flex-row flex-wrap gap-2">
            {wordParts.map((part, i) => {
              const partEntry = part.entries[0];
              const reading = partEntry?.kana[0]?.text;
              const gloss = partEntry?.senses[0]?.glosses
                ?.filter((g) => g.lang === "eng")
                .map((g) => g.text)
                .join("; ");
              return (
                <Pressable
                  key={i}
                  onPress={() => partEntry && tabRouter.pushWord(partEntry.id)}
                  className="rounded-lg border border-border px-3 py-2 bg-card active:bg-muted"
                >
                  <Text
                    className="text-lg font-medium text-foreground"
                    style={japaneseFontStyle(18)}
                  >
                    {part.matchedText}
                  </Text>
                  {reading && (
                    <Text className="text-xs text-muted-foreground" style={japaneseFontStyle(12)}>
                      {reading}
                    </Text>
                  )}
                  {gloss && (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {gloss}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {Platform.OS === "ios" && (
        <View className="mb-6">
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Open in other dictionaries
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(() => {
              const query = entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
              const encoded = encodeURIComponent(query);
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    label="Midori"
                    onPress={() => {
                      Linking.openURL(`midori://search?text=${encoded}`).catch(() => {
                        Linking.openURL(
                          "https://apps.apple.com/app/midori-japanese-dictionary/id385231773",
                        );
                      });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    label="Shirabe Jisho"
                    onPress={() => {
                      Linking.openURL(`shirabelookup://search?w=${encoded}`).catch(() => {
                        Linking.openURL("https://apps.apple.com/app/shirabe-jisho/id1005203380");
                      });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    label="DaKanji"
                    onPress={() => {
                      Linking.openURL(`dakanji://dictionary?search=${encoded}`).catch(() => {
                        Linking.openURL("https://apps.apple.com/app/dakanji/id1548746810");
                      });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    label="imiwa?"
                    onPress={() => {
                      Linking.openURL(`imiwa://analyser?text=${encoded}`).catch(() => {
                        Linking.openURL(
                          "https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125",
                        );
                      });
                    }}
                  />
                </>
              );
            })()}
          </View>
        </View>
      )}

      <BookmarkPopover
        visible={popoverVisible}
        onClose={() => {
          dismissPopover();
          setBookmarkAnchor(undefined);
        }}
        entryId={entryId}
        anchorPosition={bookmarkAnchor}
        onListToggled={onListToggled}
      />
    </ScrollView>
  );
}
