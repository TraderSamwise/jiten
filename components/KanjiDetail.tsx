import React, { useEffect, useState, useRef, useMemo } from "react";
import { View, ScrollView, Pressable, Linking, TextInput, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTabRouter } from "@/lib/navigation";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { useSearchStore } from "@/stores/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmarkKanji } from "@/hooks/useQuickBookmark";
import { useKanjiMnemonic } from "@/hooks/useKanjiMnemonic";
import { highlightKeywords } from "@/lib/highlight-keywords";
import {
  getKanjiAsync,
  getSimilarKanjiAsync,
  getSimilarByMeaningAsync,
  getRadicalsForKanjiAsync,
  getKanjiUsingRadicalAsync,
  getKanjiBatchAsync,
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
  const tabRouter = useTabRouter();
  const { setSearchMode, setSelectedRadicals } = useSearchStore();
  const [kanji, setKanji] = useState<KanjiCharacter | null>(null);
  const [similar, setSimilar] = useState<SimilarKanji[]>([]);
  const [similarMeaning, setSimilarMeaning] = useState<KanjiCharacter[]>([]);
  const [radicals, setRadicals] = useState<string[]>([]);
  const [words, setWords] = useState<DictEntry[]>([]);
  const [usedIn, setUsedIn] = useState<KanjiCharacter[]>([]);
  const [componentKanji, setComponentKanji] = useState<Map<string, KanjiCharacter>>(new Map());
  const [componentUserKeywords, setComponentUserKeywords] = useState<Map<string, string>>(new Map());
  const [editingMnemonic, setEditingMnemonic] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState(false);
  const [mnemonicDraft, setMnemonicDraft] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const mnemonicInputRef = useRef<TextInput>(null);
  const keywordInputRef = useRef<TextInput>(null);

  const userDb = useUserDb();
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`k:${literal}`));
  const { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled } =
    useQuickBookmarkKanji(literal, isBookmarked);
  const { mnemonic, keyword, saveMnemonic, saveKeyword } = useKanjiMnemonic(literal);

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
    getKanjiUsingRadicalAsync(dictDb, literal)
      .then((results) => setUsedIn(results.filter((k) => k.literal !== literal)))
      .catch(() => {});
  }, [dictDb, isReady, literal]);

  // Fetch kanji data for each radical/component to show meanings
  useEffect(() => {
    if (!dictDb || radicals.length === 0) return;
    getKanjiBatchAsync(dictDb, radicals)
      .then((kanjiList) => {
        const map = new Map<string, KanjiCharacter>();
        for (const k of kanjiList) map.set(k.literal, k);
        setComponentKanji(map);
      })
      .catch(() => {});
  }, [dictDb, radicals]);

  // Batch-load user keywords for component radicals
  useEffect(() => {
    if (!userDb || radicals.length === 0) return;
    const filtered = radicals.filter((r) => r !== literal);
    if (filtered.length === 0) return;
    const placeholders = filtered.map(() => "?").join(",");
    userDb
      .getAllAsync<{ literal: string; keyword: string }>(
        `SELECT literal, keyword FROM user_kanji_notes WHERE literal IN (${placeholders}) AND keyword IS NOT NULL AND keyword != ''`,
        filtered,
      )
      .then((rows: { literal: string; keyword: string }[]) => {
        const map = new Map<string, string>();
        for (const r of rows) map.set(r.literal, r.keyword);
        setComponentUserKeywords(map);
      })
      .catch(() => {});
  }, [userDb, radicals, literal]);

  // Compute highlighted mnemonic segments
  const mnemonicSegments = useMemo(() => {
    if (!mnemonic) return [];
    const primaryKeywords = [keyword, kanji?.heisigKeyword].filter(Boolean) as string[];
    const compKeywords: string[] = [];
    for (const r of radicals.filter((r) => r !== literal)) {
      const userKw = componentUserKeywords.get(r);
      if (userKw) compKeywords.push(userKw);
      const ck = componentKanji.get(r);
      if (ck?.heisigKeyword) compKeywords.push(ck.heisigKeyword);
      else if (ck?.meanings[0]) compKeywords.push(ck.meanings[0]);
    }
    return highlightKeywords(mnemonic, primaryKeywords, compKeywords);
  }, [mnemonic, keyword, kanji, radicals, literal, componentKanji, componentUserKeywords]);

  const handleRadicalPress = (radical: string) => {
    setSearchMode("radical");
    setSelectedRadicals([radical]);
    router.push("/dictionary");
  };

  const handleSimilarPress = (similarLiteral: string) => {
    tabRouter.pushKanji(similarLiteral);
  };

  const handleKoohiiPress = (character: string) => {
    Linking.openURL(`https://kanji.koohii.com/study/kanji/${encodeURIComponent(character)}`);
  };

  const handleRtkAppPress = (character: string) => {
    Linking.openURL(`kanji://open?action=open&kanji=${encodeURIComponent(character)}`).catch(() => {
      Linking.openURL("https://apps.apple.com/us/app/remembering-the-kanji/id424471278");
    });
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
          {kanji.heisigLesson != null && (
            <Badge variant="outline" label={`RTK Lesson ${kanji.heisigLesson}`} />
          )}
        </View>
        {kanji.heisigIndex != null && (
          <View className="flex-row gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              label="Study on Koohii"
              onPress={() => handleKoohiiPress(kanji.literal)}
            />
            <Button
              variant="outline"
              size="sm"
              label="Open in RTK App"
              onPress={() => handleRtkAppPress(kanji.literal)}
            />
          </View>
        )}
      </View>

      {/* Mnemonic & Keyword */}
      <Card className="mb-3">
        <Text className="text-sm font-medium text-muted-foreground mb-2">Mnemonic</Text>

        {/* Keyword field */}
        <View className="flex-row items-center mb-2">
          <Text className="text-xs text-muted-foreground mr-1.5">Keyword:</Text>
          {editingKeyword ? (
            <TextInput
              ref={keywordInputRef}
              className="flex-1 text-sm text-blue-500 font-semibold bg-secondary/50 rounded px-2 py-0.5"
              value={keywordDraft}
              onChangeText={setKeywordDraft}
              placeholder="set keyword..."
              placeholderTextColor="#999"
              autoFocus
              onSubmitEditing={() => {
                saveKeyword(keywordDraft);
                setEditingKeyword(false);
              }}
              onBlur={() => {
                saveKeyword(keywordDraft);
                setEditingKeyword(false);
              }}
            />
          ) : (
            <Pressable
              onPress={() => {
                setKeywordDraft(keyword ?? "");
                setEditingKeyword(true);
                setTimeout(() => keywordInputRef.current?.focus(), 50);
              }}
              className="flex-1"
            >
              {keyword ? (
                <Text className="text-sm text-blue-500 font-semibold">{keyword}</Text>
              ) : (
                <Text className="text-sm text-muted-foreground/60 italic">tap to set...</Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Story field */}
        {editingMnemonic ? (
          <TextInput
            ref={mnemonicInputRef}
            className="text-base text-foreground bg-secondary/50 rounded-lg p-3 min-h-[80px]"
            value={mnemonicDraft}
            onChangeText={setMnemonicDraft}
            multiline
            textAlignVertical="top"
            placeholder="Write your mnemonic story..."
            placeholderTextColor="#999"
            autoFocus
            onBlur={() => {
              saveMnemonic(mnemonicDraft);
              setEditingMnemonic(false);
            }}
          />
        ) : (
          <Pressable
            onPress={() => {
              setMnemonicDraft(mnemonic ?? "");
              setEditingMnemonic(true);
              setTimeout(() => mnemonicInputRef.current?.focus(), 50);
            }}
          >
            {mnemonic ? (
              <Text className="text-base text-foreground">
                {mnemonicSegments.map((seg, i) =>
                  seg.type === "plain" ? (
                    <React.Fragment key={i}>{seg.text}</React.Fragment>
                  ) : (
                    <Text
                      key={i}
                      className={
                        seg.type === "primary"
                          ? "text-blue-500 font-semibold"
                          : "text-green-600"
                      }
                    >
                      {seg.text}
                    </Text>
                  ),
                )}
              </Text>
            ) : (
              <Text className="text-base text-muted-foreground italic">
                Tap to add a mnemonic story...
              </Text>
            )}
          </Pressable>
        )}
      </Card>

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

      {/* Components */}
      {radicals.filter((r) => r !== literal).length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Components</Text>
          <View className="flex-row flex-wrap gap-2">
            {radicals.filter((r) => r !== literal).map((r) => {
              const ck = componentKanji.get(r);
              const userKw = componentUserKeywords.get(r);
              const meaning = userKw ?? ck?.heisigKeyword ?? ck?.meanings[0];
              const meaningColor = userKw
                ? "text-xs text-blue-500 font-medium"
                : ck?.heisigKeyword
                  ? "text-xs text-muted-foreground"
                  : "text-xs text-muted-foreground/60";
              return (
                <Pressable
                  key={r}
                  onPress={() => {
                    if (ck) {
                      tabRouter.pushKanji(r);
                    } else {
                      handleRadicalPress(r);
                    }
                  }}
                  className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
                >
                  <Text className="text-xl font-bold text-foreground">{r}</Text>
                  {meaning && (
                    <Text className={meaningColor} numberOfLines={1}>
                      {meaning}
                    </Text>
                  )}
                </Pressable>
              );
            })}
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

      {/* Used as component in */}
      {usedIn.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Used as Component in
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {usedIn.map((k) => (
              <Pressable
                key={k.literal}
                onPress={() => handleSimilarPress(k.literal)}
                className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
              >
                <Text className="text-xl font-bold text-foreground">{k.literal}</Text>
                <Text className="text-xs text-muted-foreground">
                  {k.heisigKeyword ?? k.meanings[0] ?? ""}
                </Text>
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

      {Platform.OS === "ios" && (
        <View className="mb-6">
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Open in other dictionaries
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              label="Midori"
              onPress={() => {
                const url = `midori://search?text=${encodeURIComponent(kanji.literal)}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL("https://apps.apple.com/app/midori-japanese-dictionary/id385231773");
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              label="Shirabe Jisho"
              onPress={() => {
                const url = `shirabelookup://search?k=${encodeURIComponent(kanji.literal)}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL("https://apps.apple.com/app/shirabe-jisho/id1005203380");
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              label="DaKanji"
              onPress={() => {
                const url = `dakanji://dictionary?search=${encodeURIComponent(kanji.literal)}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL("https://apps.apple.com/app/dakanji/id1548746810");
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              label="imiwa?"
              onPress={() => {
                const url = `imiwa://analyser?text=${encodeURIComponent(kanji.literal)}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL("https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125");
                });
              }}
            />
          </View>
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
