import React, { useCallback, useEffect, useState } from "react";
import { View, SectionList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { PressableCard, CardTitle } from "@/components/ui/card";
import { SwipeableRow, type SwipeAction } from "@/components/SwipeableRow";
import { Download, Trash2 } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import {
  fetchTableOfContents,
  fetchChapterText,
  type SyosetuTocSection,
  type SyosetuChapter,
} from "@/lib/syosetu-api";
import { alert } from "@/lib/confirm";
import { useSync } from "@/db/sync-provider";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

type ImportStatus = { id: string; saved: number };

export default function NovelSyosetuScreen() {
  const { ncode, title, writer } = useLocalSearchParams<{
    ncode: string;
    title: string;
    writer: string;
  }>();
  const router = useRouter();
  const userDb = useUserDb();
  const { triggerSync } = useSync();

  const [sections, setSections] = useState<SyosetuTocSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [importMap, setImportMap] = useState<Map<string, ImportStatus>>(new Map());

  // Refresh import status for all chapters
  const refreshImportStatus = useCallback(
    async (toc: SyosetuTocSection[]) => {
      if (!userDb || !ncode || toc.length === 0) {
        setImportMap(new Map());
        return;
      }
      const sourceIds = toc.flatMap((s) => s.chapters.map((c) => `${ncode}/${c.number}`));
      if (sourceIds.length === 0) return;
      const placeholders = sourceIds.map(() => "?").join(",");
      const rows = await userDb.getAllAsync<{ id: string; source_id: string; saved: number }>(
        `SELECT id, source_id, saved FROM books WHERE source = 'syosetu' AND source_id IN (${placeholders}) AND deleted_at IS NULL`,
        sourceIds,
      );
      const map = new Map<string, ImportStatus>();
      for (const row of rows) {
        map.set(row.source_id, { id: row.id, saved: row.saved });
      }
      setImportMap(map);
    },
    [userDb, ncode],
  );

  useEffect(() => {
    if (!ncode) return;
    let cancelled = false;
    (async () => {
      try {
        const toc = await fetchTableOfContents(ncode);
        if (!cancelled) {
          setSections(toc);
          refreshImportStatus(toc);
        }
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
  }, [ncode, refreshImportStatus]);

  async function downloadAndInsert(chapter: SyosetuChapter, saved: number): Promise<string | null> {
    if (!userDb || !ncode) return null;

    const sourceId = `${ncode}/${chapter.number}`;
    setDownloading(chapter.number);
    try {
      const rawContent = await fetchChapterText(ncode, chapter.number);
      if (!rawContent) {
        alert("Empty chapter", "No text content found for this chapter.");
        return null;
      }

      const now = new Date().toISOString();
      const id = generateId();
      const bookTitle = `${title} — ${chapter.title}`;

      await userDb.runAsync(
        `INSERT OR IGNORE INTO books (id, title, author, source, source_id, raw_content, saved, created_at, updated_at)
         VALUES (?, ?, ?, 'syosetu', ?, ?, ?, ?, ?)`,
        [id, bookTitle, writer ?? "", sourceId, rawContent, saved, now, now],
      );

      // Evict oldest unsaved books beyond cap
      if (saved === 0) {
        await userDb.runAsync(
          `DELETE FROM books WHERE saved = 0 AND deleted_at IS NULL AND source != 'article'
           AND id NOT IN (SELECT id FROM books WHERE saved = 0 AND deleted_at IS NULL AND source != 'article' ORDER BY created_at DESC LIMIT 10)`,
          [],
        );
      }

      triggerSync();
      setImportMap((prev) => new Map(prev).set(sourceId, { id, saved }));
      return id;
    } catch (err) {
      alert("Download failed", err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setDownloading(null);
    }
  }

  const handleChapterPress = useCallback(
    async (chapter: SyosetuChapter) => {
      if (!userDb || !ncode) return;

      const sourceId = `${ncode}/${chapter.number}`;
      const status = importMap.get(sourceId);

      if (status) {
        router.push(`/reader/${status.id}`);
        return;
      }

      // Not in DB — download as preview (saved=0) and navigate
      const id = await downloadAndInsert(chapter, 0);
      if (id) router.push(`/reader/${id}`);
    },
    [userDb, ncode, router, importMap],
  );

  const handleImport = useCallback(
    async (chapter: SyosetuChapter) => {
      if (!userDb || !ncode) return;

      const sourceId = `${ncode}/${chapter.number}`;
      const status = importMap.get(sourceId);

      if (status) {
        const now = new Date().toISOString();
        await userDb.runAsync("UPDATE books SET saved = 1, updated_at = ? WHERE id = ?", [
          now,
          status.id,
        ]);
        triggerSync();
        setImportMap((prev) => new Map(prev).set(sourceId, { ...status, saved: 1 }));
      } else {
        await downloadAndInsert(chapter, 1);
      }
    },
    [userDb, ncode, importMap, triggerSync],
  );

  const handleRemove = useCallback(
    async (chapter: SyosetuChapter) => {
      if (!userDb || !ncode) return;

      const sourceId = `${ncode}/${chapter.number}`;
      const status = importMap.get(sourceId);
      if (!status) return;

      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE books SET saved = 0, updated_at = ? WHERE id = ?", [
        now,
        status.id,
      ]);
      triggerSync();
      setImportMap((prev) => new Map(prev).set(sourceId, { ...status, saved: 0 }));
    },
    [userDb, ncode, importMap, triggerSync],
  );

  const sectionListData = sections.map((section) => ({
    title: section.volumeTitle,
    data: section.chapters,
  }));

  const renderItem = useCallback(
    ({ item }: { item: SyosetuChapter }) => {
      const isDownloading = downloading === item.number;
      const sourceId = `${ncode}/${item.number}`;
      const status = importMap.get(sourceId);

      const actions: SwipeAction[] =
        status?.saved === 1
          ? [{ label: "Remove", icon: Trash2, color: "#ef4444", onPress: () => handleRemove(item) }]
          : [
              {
                label: "Import",
                icon: Download,
                color: "#3b82f6",
                onPress: () => handleImport(item),
              },
            ];

      return (
        <SwipeableRow actions={actions}>
          <PressableCard
            onPress={() => handleChapterPress(item)}
            className={`mb-1 ${status?.saved === 1 ? "bg-primary/5" : ""}`}
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
        </SwipeableRow>
      );
    },
    [downloading, ncode, handleChapterPress, handleImport, handleRemove, importMap],
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
