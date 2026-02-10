import React, { useCallback, useEffect, useState } from "react";
import { View, SectionList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { PressableCard, CardTitle } from "@/components/ui/card";
import { useUserDb } from "@/db/user-provider";
import {
  fetchTableOfContents,
  fetchChapterText,
  type SyosetuTocSection,
  type SyosetuChapter,
} from "@/lib/syosetu-api";
import { alert } from "@/lib/confirm";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function NovelSyosetuScreen() {
  const { ncode, title, writer } = useLocalSearchParams<{
    ncode: string;
    title: string;
    writer: string;
  }>();
  const router = useRouter();
  const userDb = useUserDb();

  const [sections, setSections] = useState<SyosetuTocSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);

  useEffect(() => {
    if (!ncode) return;
    let cancelled = false;
    (async () => {
      try {
        const toc = await fetchTableOfContents(ncode);
        if (!cancelled) setSections(toc);
      } catch (err) {
        if (!cancelled) {
          alert("Failed to load chapters", err instanceof Error ? err.message : "Network error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ncode]);

  const handleChapterPress = useCallback(
    async (chapter: SyosetuChapter) => {
      if (!userDb || !ncode) return;

      const sourceId = `${ncode}/${chapter.number}`;

      // Check if already downloaded
      const existing = await userDb.getFirstAsync<any>(
        "SELECT id FROM books WHERE source_id = ? AND source = 'syosetu'",
        [sourceId],
      );
      if (existing) {
        router.push(`/reader/${existing.id}`);
        return;
      }

      setDownloading(chapter.number);
      try {
        const rawContent = await fetchChapterText(ncode, chapter.number);
        if (!rawContent) {
          alert("Empty chapter", "No text content found for this chapter.");
          return;
        }

        const now = new Date().toISOString();
        const id = generateId();
        const bookTitle = `${title} — ${chapter.title}`;

        await userDb.runAsync(
          `INSERT INTO books (id, title, author, source, source_id, raw_content, created_at, updated_at)
           VALUES (?, ?, ?, 'syosetu', ?, ?, ?, ?)`,
          [id, bookTitle, writer ?? "", sourceId, rawContent, now, now],
        );

        router.push(`/reader/${id}`);
      } catch (err) {
        alert("Download failed", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setDownloading(null);
      }
    },
    [userDb, ncode, title, writer, router],
  );

  const sectionListData = sections.map((section) => ({
    title: section.volumeTitle,
    data: section.chapters,
  }));

  const renderItem = useCallback(
    ({ item }: { item: SyosetuChapter }) => {
      const isDownloading = downloading === item.number;
      return (
        <PressableCard
          onPress={() => handleChapterPress(item)}
          className="mb-1"
          disabled={isDownloading}
        >
          <View className="flex-row items-center">
            <Text className="text-muted-foreground mr-3 w-8 text-right">{item.number}</Text>
            <View className="flex-1">
              <CardTitle numberOfLines={2} className="text-base">
                {item.title}
              </CardTitle>
            </View>
            {isDownloading && <ActivityIndicator className="ml-2" />}
          </View>
        </PressableCard>
      );
    },
    [downloading, handleChapterPress],
  );

  const renderSectionHeader = useCallback(({ section }: { section: { title: string | null } }) => {
    if (!section.title) return null;
    return (
      <View className="px-4 py-2 bg-background">
        <Text className="text-sm font-semibold text-muted-foreground">{section.title}</Text>
      </View>
    );
  }, []);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" />
        <Text className="mt-2 text-muted-foreground">Loading chapters...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <Text className="text-lg font-bold" numberOfLines={2}>
          {title}
        </Text>
        {writer ? <Text className="text-sm text-muted-foreground">{writer}</Text> : null}
      </View>

      <SectionList
        sections={sectionListData}
        keyExtractor={(item) => String(item.number)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-muted-foreground">No chapters found.</Text>
          </View>
        }
      />
    </View>
  );
}
