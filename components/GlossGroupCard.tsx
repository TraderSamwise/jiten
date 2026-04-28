import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { PitchAccent } from "@/components/PitchAccent";
import { PlayAudioButton } from "@/components/PlayAudioButton";
import { BOOKMARK_HIGHLIGHT_CLASS, BOOKMARK_HIGHLIGHT_STYLE } from "@/lib/bookmark-styles";
import { Bookmark, ChevronRight } from "@/lib/icons";
import { useSearchStore } from "@/stores/search";
import { useBookmarkStore } from "@/stores/bookmarks";
import type { GlossGroup } from "@/db/types";

interface GlossGroupCardProps {
  group: GlossGroup;
}

export const GlossGroupCard = React.memo(function GlossGroupCard({ group }: GlossGroupCardProps) {
  const router = useRouter();
  const setSelectedGlossGroup = useSearchStore((s) => s.setSelectedGlossGroup);
  const isMulti = group.entries.length > 1;
  const singleEntryId = !isMulti ? group.entries[0]?.id : null;
  const isSingleEntryBookmarked = useBookmarkStore((s) =>
    singleEntryId != null ? s.bookmarkedIds.has(`e:${singleEntryId}`) : false,
  );

  const handlePress = () => {
    if (isMulti) {
      setSelectedGlossGroup(group);
      router.push("/dictionary/gloss-group");
    } else {
      router.push(`/dictionary/word/${group.entries[0].id}`);
    }
  };

  if (!isMulti) {
    const entry = group.entries[0];
    const kanjiText = entry.kanji[0]?.text;
    const kana = entry.kana[0];
    const accents = kana ? entry.pitchAccents.filter((pa) => pa.reading === kana.text) : [];

    return (
      <PressableCard className="mb-2" onPress={handlePress}>
        <Text className="text-base font-bold text-foreground">{group.gloss}</Text>
        <View className="flex-row items-start justify-between gap-3 mt-1">
          <View className="flex-1">
            <View
              className={
                isSingleEntryBookmarked
                  ? `flex-row items-center gap-2 ${BOOKMARK_HIGHLIGHT_CLASS}`
                  : "flex-row items-center gap-2"
              }
              style={isSingleEntryBookmarked ? BOOKMARK_HIGHLIGHT_STYLE : undefined}
            >
              {kanjiText && (
                <Text
                  className={`text-lg text-foreground ${entry.common ? "bg-green-100 dark:bg-green-900 rounded px-1" : ""}`}
                >
                  {kanjiText}
                </Text>
              )}
              {kana &&
                (accents.length > 0 ? (
                  <View className="flex-row items-center gap-1">
                    {accents.map((pa, i) => (
                      <PitchAccent key={i} accent={pa} />
                    ))}
                  </View>
                ) : (
                  <Text className="text-sm text-muted-foreground">{kana.text}</Text>
                ))}
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            {isSingleEntryBookmarked ? (
              <Bookmark size={16} className="text-primary fill-primary" />
            ) : null}
            <PlayAudioButton entryId={entry.id} size={18} />
          </View>
        </View>
      </PressableCard>
    );
  }

  const japaneseEntries = (() => {
    const seen = new Map<string, { label: string; common: boolean; bookmarked: boolean }>();
    for (const e of group.entries) {
      const label = e.kanji[0]?.text ?? e.kana[0]?.text ?? "";
      if (!label) continue;
      const bookmarked = useBookmarkStore.getState().bookmarkedIds.has(`e:${e.id}`);
      const existing = seen.get(label);
      if (existing) {
        if (e.common) existing.common = true;
        if (bookmarked) existing.bookmarked = true;
      } else {
        seen.set(label, { label, common: e.common, bookmarked });
      }
    }
    return [...seen.values()];
  })();

  return (
    <PressableCard className="mb-2" onPress={handlePress}>
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground">{group.gloss}</Text>
          <View className="flex-row flex-wrap mt-1 gap-1.5">
            {japaneseEntries.map((e, i) => (
              <View
                key={i}
                className={
                  e.bookmarked
                    ? `flex-row items-baseline ${BOOKMARK_HIGHLIGHT_CLASS}`
                    : "flex-row items-baseline"
                }
                style={e.bookmarked ? BOOKMARK_HIGHLIGHT_STYLE : undefined}
              >
                <Text
                  className={`text-sm ${e.common ? "text-foreground bg-green-100 dark:bg-green-900 rounded px-1" : "text-muted-foreground"}`}
                >
                  {e.label}
                </Text>
                {i < japaneseEntries.length - 1 && !e.common && (
                  <Text className="text-sm text-muted-foreground">, </Text>
                )}
              </View>
            ))}
          </View>
        </View>
        <ChevronRight size={20} className="text-muted-foreground ml-2" />
      </View>
    </PressableCard>
  );
});
