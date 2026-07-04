import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Linking,
  TextInput,
  Platform,
  InteractionManager,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useTabRouter } from "@/lib/navigation";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { Bookmark, Pencil } from "@/lib/icons";
import { BOOKMARK_HIGHLIGHT_CLASS, BOOKMARK_HIGHLIGHT_STYLE } from "@/lib/bookmark-styles";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { useSearchStore } from "@/stores/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useQuickBookmarkKanji } from "@/hooks/useQuickBookmark";
import { useKanjiMnemonic } from "@/hooks/useKanjiMnemonic";
import { MnemonicText } from "@/components/MnemonicText";
import { MnemonicEditor } from "@/components/MnemonicEditor";
import { PrimitiveGlyph } from "@/components/PrimitiveGlyph";
import {
  getKanjiAsync,
  getSimilarKanjiAsync,
  getSimilarByMeaningAsync,
  getRadicalsForKanjiAsync,
  getKanjiUsingRadicalAsync,
  getKanjiBatchAsync,
  getStrokePathsAsync,
  getPrimitivesForKanjiAsync,
} from "@/db/kanji-search";
import { getWordsForKanjiAsync } from "@/db/search";
import { EntryCard } from "@/components/EntryCard";
import { StrokeOrderDiagram } from "@/components/StrokeOrderDiagram";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { japaneseFontStyle } from "@/lib/japanese-font";
import type {
  KanjiCharacter,
  StrokePath,
  SimilarKanji,
  DictEntry,
  KanjiPrimitive,
} from "@/db/types";

interface KanjiDetailProps {
  literal: string;
}

export function KanjiDetail({ literal }: KanjiDetailProps) {
  const { dictDb, strokesDb, isReady } = useDatabase();
  const router = useRouter();
  const tabRouter = useTabRouter();
  const setSearchMode = useSearchStore((s) => s.setSearchMode);
  const setSelectedRadicals = useSearchStore((s) => s.setSelectedRadicals);
  const [kanji, setKanji] = useState<KanjiCharacter | null>(null);
  const [similar, setSimilar] = useState<SimilarKanji[]>([]);
  const [similarMeaning, setSimilarMeaning] = useState<KanjiCharacter[]>([]);
  const [radicals, setRadicals] = useState<string[]>([]);
  const [strokePaths, setStrokePaths] = useState<StrokePath[]>([]);
  const [primitives, setPrimitives] = useState<KanjiPrimitive[]>([]);
  const [words, setWords] = useState<DictEntry[]>([]);
  const [usedIn, setUsedIn] = useState<KanjiCharacter[]>([]);
  const [componentKanji, setComponentKanji] = useState<Map<string, KanjiCharacter>>(new Map());
  const [componentUserKeywords, setComponentUserKeywords] = useState<Map<string, string>>(
    new Map(),
  );
  const [editingMnemonic, setEditingMnemonic] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState(false);
  const [mnemonicDraft, setMnemonicDraft] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const keywordInputRef = useRef<TextInput>(null);

  const userDb = useUserDb();
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`k:${literal}`));
  const { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled } =
    useQuickBookmarkKanji(literal, isBookmarked);
  const bookmarkRef = useRef<View>(null);
  const [bookmarkAnchor, setBookmarkAnchor] = useState<
    { top: number; right: number } | undefined
  >();
  const { mnemonic, keyword, saveMnemonic, saveKeyword } = useKanjiMnemonic(literal);

  const startEditKeyword = () => {
    setKeywordDraft(keyword ?? kanji?.heisigKeyword ?? "");
    setEditingKeyword(true);
    setTimeout(() => keywordInputRef.current?.focus(), 50);
  };
  const commitKeyword = () => {
    // A keyword equal to the Heisig default (or blank) is stored as null, so it keeps
    // tracking the dictionary rather than freezing a redundant override.
    const trimmed = keywordDraft.trim();
    saveKeyword(trimmed && trimmed !== (kanji?.heisigKeyword ?? "") ? trimmed : "");
    setEditingKeyword(false);
  };

  function measureAndRun(callback: () => void) {
    bookmarkRef.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get("window").width;
      setBookmarkAnchor({ top: y + height + 4, right: screenWidth - x - width });
      callback();
    });
  }

  useEffect(() => {
    if (!dictDb || !isReady || !literal) return;

    const task = InteractionManager.runAfterInteractions(() => {
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
    });
    return () => task.cancel();
  }, [dictDb, isReady, literal]);

  // Lazy-load stroke paths from background-downloaded strokes DB
  useEffect(() => {
    if (!strokesDb || !literal) return;
    getStrokePathsAsync(strokesDb, literal)
      .then(setStrokePaths)
      .catch(() => {});
  }, [strokesDb, literal]);

  // Lazy-load RTK primitive decomposition from the strokes DB
  useEffect(() => {
    if (!strokesDb || !literal) {
      setPrimitives([]);
      return;
    }
    getPrimitivesForKanjiAsync(strokesDb, literal)
      .then(setPrimitives)
      .catch(() => {});
  }, [strokesDb, literal]);

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

  // Batch-load user keywords for component radicals (re-fetch on focus)
  const loadComponentUserKeywords = useCallback(() => {
    if (!userDb || radicals.length === 0) return;
    const filtered = radicals.filter((r) => r !== literal);
    if (filtered.length === 0) return;
    const placeholders = filtered.map(() => "?").join(",");
    userDb
      .getAllAsync<{ literal: string; keyword: string }>(
        `SELECT literal, keyword FROM user_kanji_notes WHERE literal IN (${placeholders}) AND keyword IS NOT NULL AND keyword != '' AND deleted_at IS NULL`,
        filtered,
      )
      .then((rows: { literal: string; keyword: string }[]) => {
        const map = new Map<string, string>();
        for (const r of rows) map.set(r.literal, r.keyword);
        setComponentUserKeywords(map);
      })
      .catch(() => {});
  }, [userDb, radicals, literal]);

  useFocusEffect(
    useCallback(() => {
      loadComponentUserKeywords();
    }, [loadComponentUserKeywords]),
  );

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
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-muted-foreground">Loading kanji...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View className="items-center mb-6">
        <View className="flex-row justify-end w-full mb-2">
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
        {kanji.jlptLevel != null && (
          <Text className="absolute top-12 right-0 text-xs font-semibold text-muted-foreground">
            JLPT N{kanji.jlptLevel}
          </Text>
        )}
        <View
          className={isBookmarked ? BOOKMARK_HIGHLIGHT_CLASS : undefined}
          style={isBookmarked ? BOOKMARK_HIGHLIGHT_STYLE : undefined}
        >
          <Text className="text-7xl text-foreground leading-tight" style={japaneseFontStyle(72)}>
            {kanji.literal}
          </Text>
          {editingKeyword ? (
            <TextInput
              ref={keywordInputRef}
              className="mt-1 min-w-[140px] rounded bg-secondary/50 px-2 py-0.5 text-lg font-medium text-blue-500"
              value={keywordDraft}
              onChangeText={setKeywordDraft}
              placeholder={kanji.heisigKeyword ?? "keyword"}
              placeholderTextColor="#999"
              autoFocus
              onSubmitEditing={commitKeyword}
              onBlur={commitKeyword}
            />
          ) : (
            <Pressable onPress={startEditKeyword} className="mt-1 flex-row items-center gap-1.5">
              <Text
                className={
                  keyword
                    ? "text-lg font-medium text-blue-500"
                    : kanji.heisigKeyword
                      ? "text-lg text-muted-foreground"
                      : "text-lg italic text-muted-foreground/50"
                }
              >
                {keyword ?? kanji.heisigKeyword ?? "set keyword…"}
              </Text>
              <Pencil size={13} className="text-muted-foreground/50" />
            </Pressable>
          )}
        </View>
        <View className="flex-row flex-wrap justify-center gap-2 mt-3">
          {kanji.grade != null && <Badge variant="secondary" label={`Grade ${kanji.grade}`} />}
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

      {/* Stroke Order */}
      {strokePaths.length > 0 && (
        <Card className="mb-3">
          <StrokeOrderDiagram
            strokes={strokePaths}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">Stroke Order</Text>
            }
          />
        </Card>
      )}

      {/* Mnemonic */}
      <Card className="mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-sm font-medium text-muted-foreground">Mnemonic</Text>
          {mnemonic && !editingMnemonic && (
            <Pressable
              onPress={() => {
                setMnemonicDraft(mnemonic ?? "");
                setEditingMnemonic(true);
              }}
            >
              <Text className="text-xs font-medium text-blue-500">Edit</Text>
            </Pressable>
          )}
        </View>

        {/* Story field */}
        {editingMnemonic ? (
          <MnemonicEditor
            literal={literal}
            initialValue={mnemonicDraft}
            primitives={primitives}
            autoFocus
            onSave={(t) => {
              saveMnemonic(t);
              setEditingMnemonic(false);
            }}
            onCancel={() => setEditingMnemonic(false)}
          />
        ) : mnemonic ? (
          <MnemonicText
            mnemonic={mnemonic}
            selfKeyword={keyword ?? kanji?.heisigKeyword ?? null}
            primitives={primitives}
            onNavigate={tabRouter.pushTarget}
          />
        ) : (
          <Pressable
            onPress={() => {
              setMnemonicDraft("");
              setEditingMnemonic(true);
            }}
          >
            <Text className="text-base text-muted-foreground italic">
              Tap to add a mnemonic story...
            </Text>
          </Pressable>
        )}
      </Card>

      {/* Readings */}
      <Card className="mb-3">
        <Text className="text-sm font-medium text-muted-foreground mb-2">Readings</Text>
        {kanji.readingsOn.length > 0 && (
          <View className="flex-row items-baseline gap-2 mb-2">
            <Text className="text-xs text-muted-foreground w-16" numberOfLines={1}>
              ON'yomi
            </Text>
            <View className="flex-1 flex-row flex-wrap">
              {kanji.readingsOn.map((r, i) => (
                <Text key={i} className="text-base text-foreground">
                  {r}
                  {i < kanji.readingsOn.length - 1 && "、 "}
                </Text>
              ))}
            </View>
          </View>
        )}
        {kanji.readingsKun.length > 0 && (
          <View className="flex-row items-baseline gap-2 mb-2">
            <Text className="text-xs text-muted-foreground w-16" numberOfLines={1}>
              KUN'yomi
            </Text>
            <View className="flex-1 flex-row flex-wrap">
              {kanji.readingsKun.map((r, i) => (
                <Text key={i} className="text-base text-foreground">
                  {r}
                  {i < kanji.readingsKun.length - 1 && "、 "}
                </Text>
              ))}
            </View>
          </View>
        )}
        {kanji.nanori.length > 0 && (
          <View className="flex-row items-baseline gap-2">
            <Text className="text-xs text-muted-foreground w-16" numberOfLines={1}>
              Nanori
            </Text>
            <View className="flex-1 flex-row flex-wrap">
              {kanji.nanori.map((r, i) => (
                <Text key={i} className="text-base text-foreground">
                  {r}
                  {i < kanji.nanori.length - 1 && "、 "}
                </Text>
              ))}
            </View>
          </View>
        )}
      </Card>

      {/* Meanings */}
      {kanji.meanings.length > 0 && (
        <Card className="mb-3">
          <Text className="text-sm font-medium text-muted-foreground mb-2">Meanings</Text>
          <Text className="text-base text-foreground">{kanji.meanings.join(", ")}</Text>
        </Card>
      )}

      {/* Primitive Elements (RTK decomposition) */}
      {primitives.length > 0 && (
        <Card className="mb-3">
          <CollapsibleSection
            collapsedHeight={90}
            fadeHeight={30}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">
                Primitive Elements
              </Text>
            }
          >
            <View className="flex-row flex-wrap gap-2">
              {primitives.map((p) => {
                const hasGlyph = p.glyph != null;
                const onPress = hasGlyph
                  ? () => tabRouter.pushKanji(p.glyph as string)
                  : p.primitiveId != null
                    ? () => tabRouter.pushPrimitive(p.primitiveId as number)
                    : undefined;
                return (
                  <Pressable
                    key={p.position}
                    onPress={onPress}
                    disabled={!onPress}
                    className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
                  >
                    <PrimitiveGlyph
                      glyph={p.glyph}
                      displayGlyph={p.displayGlyph}
                      className="text-xl font-bold text-foreground"
                    />
                    {p.keyword != null && (
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {p.keyword}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </CollapsibleSection>
        </Card>
      )}

      {/* Components */}
      {radicals.filter((r) => r !== literal).length > 0 && (
        <Card className="mb-3">
          <CollapsibleSection
            collapsedHeight={90}
            fadeHeight={30}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">Components</Text>
            }
          >
            <View className="flex-row flex-wrap gap-2">
              {radicals
                .filter((r) => r !== literal)
                .map((r) => {
                  const ck = componentKanji.get(r);
                  const userKw = componentUserKeywords.get(r);
                  const meaning = userKw ?? ck?.heisigKeyword ?? ck?.meanings[0];
                  const meaningColor = userKw
                    ? "text-xs text-blue-500 font-medium"
                    : ck?.heisigKeyword
                      ? "text-xs text-foreground font-medium"
                      : "text-xs text-muted-foreground";
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
          </CollapsibleSection>
        </Card>
      )}

      {/* Similar Visually */}
      {similar.length > 0 && (
        <Card className="mb-3">
          <CollapsibleSection
            collapsedHeight={90}
            fadeHeight={30}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">
                Similar Visually
              </Text>
            }
          >
            <View className="flex-row flex-wrap gap-2">
              {similar.map((s) => (
                <Pressable
                  key={s.literal}
                  onPress={() => handleSimilarPress(s.literal)}
                  className="items-center rounded-lg bg-secondary px-2.5 py-1.5 active:opacity-70"
                >
                  <Text className="text-xl font-bold text-foreground">{s.literal}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {Math.round(s.score * 100)}%
                  </Text>
                </Pressable>
              ))}
            </View>
          </CollapsibleSection>
        </Card>
      )}

      {/* Similar Meaning */}
      {similarMeaning.length > 0 && (
        <Card className="mb-3">
          <CollapsibleSection
            collapsedHeight={90}
            fadeHeight={30}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">
                Similar Meaning
              </Text>
            }
          >
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
          </CollapsibleSection>
        </Card>
      )}

      {/* Used as component in */}
      {usedIn.length > 0 && (
        <Card className="mb-3">
          <CollapsibleSection
            collapsedHeight={90}
            fadeHeight={30}
            header={
              <Text className="text-sm font-medium text-muted-foreground mb-2">
                Used as Component in
              </Text>
            }
          >
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
          </CollapsibleSection>
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
                  Linking.openURL(
                    "https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125",
                  );
                });
              }}
            />
          </View>
        </View>
      )}

      <BookmarkPopover
        visible={popoverVisible}
        onClose={() => {
          dismissPopover();
          setBookmarkAnchor(undefined);
        }}
        kanjiLiteral={literal}
        anchorPosition={bookmarkAnchor}
        onListToggled={onListToggled}
      />
    </ScrollView>
  );
}
