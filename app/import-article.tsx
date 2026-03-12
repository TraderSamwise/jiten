import { useEffect, useRef } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { CommonActions } from "@react-navigation/native";
import { Text } from "@/components/ui/text";
import { useUserDb } from "@/db/user-provider";
import { importArticle } from "@/lib/article-import";

export default function ImportArticleScreen() {
  const params = useLocalSearchParams<{
    title: string;
    content: string;
    url: string;
    byline: string;
    imageUrl: string;
  }>();
  const router = useRouter();
  const navigation = useNavigation();
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

    const imageUrl = params.imageUrl || "";

    importArticle(userDb, { title, content, url: articleUrl, byline, imageUrl })
      .then((bookId) => {
        // Reset the entire navigation tree atomically so the reader tab has
        // the correct stack [index, [bookId]] — same as tapping an existing
        // book. No intermediate screen flash, correct back gesture direction.
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: "(tabs)",
                state: {
                  routes: [
                    {
                      name: "reader",
                      state: {
                        index: 1,
                        routes: [{ name: "index" }, { name: "[bookId]", params: { bookId } }],
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
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
