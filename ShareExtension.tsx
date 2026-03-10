import { useEffect } from "react";
import { Text, View, ActivityIndicator, StyleSheet } from "react-native";
import { close, openHostApp, type InitialProps } from "expo-share-extension";

interface PreprocessingResults {
  title?: string;
  content?: string;
  url?: string;
  byline?: string;
  excerpt?: string;
}

export default function ShareExtension({ preprocessingResults }: InitialProps) {
  useEffect(() => {
    const results = (preprocessingResults ?? {}) as PreprocessingResults;

    const params = new URLSearchParams();
    if (results.title) params.set("title", results.title);
    if (results.url) params.set("url", results.url);
    if (results.byline) params.set("byline", results.byline);
    if (results.content) {
      // Truncate at 200KB to stay within URL scheme limits
      const content =
        results.content.length > 200_000 ? results.content.slice(0, 200_000) : results.content;
      params.set("content", content);
    }

    openHostApp(`import-article?${params.toString()}`);
    close();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#999" />
      <Text style={styles.text}>Saving article...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
  },
  text: {
    marginTop: 16,
    color: "#999",
    fontSize: 16,
  },
});
