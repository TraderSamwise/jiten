import { useEffect, useRef } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { useUserDb } from "@/db/user-provider";
import { importArticle } from "@/lib/article-import";

export default function ImportArticleScreen() {
  const params = useLocalSearchParams<{
    title: string;
    content: string;
    url: string;
    byline: string;
  }>();
  const router = useRouter();
  const userDb = useUserDb();
  const imported = useRef(false);

  useEffect(() => {
    if (!userDb || imported.current) return;
    imported.current = true;

    const title = params.title || "";
    const content = params.content || "";
    const articleUrl = params.url || "";
    const byline = params.byline || "";

    if (!content && !title) {
      router.replace("/reader" as any);
      return;
    }

    importArticle(userDb, { title, content, url: articleUrl, byline })
      .then((bookId) => {
        router.replace(`/reader/${bookId}` as any);
      })
      .catch((e) => {
        console.error("Article import failed:", e);
        router.replace("/reader" as any);
      });
  }, [userDb]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
      <Text className="mt-4 text-muted-foreground">Importing article…</Text>
    </View>
  );
}
