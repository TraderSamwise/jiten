import { View, ScrollView, Pressable, Platform, StyleSheet } from "react-native";
import { Text } from "@/components/ui/text";
import { getVersionString, getVersionCode } from "@/lib/version";

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const handleCheckForUpdates = async () => {
    if (Platform.OS === "web" || __DEV__) {
      retry();
      return;
    }
    try {
      const Updates = await import("expo-updates");
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } else {
        retry();
      }
    } catch {
      retry();
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Something went wrong</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Error</Text>
        <Text style={styles.errorMessage}>{error.message}</Text>
      </View>

      {error.stack && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stack Trace</Text>
          <Text style={styles.stackTrace}>{error.stack}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>Try Again</Text>
      </Pressable>

      <Pressable style={styles.buttonOutline} onPress={handleCheckForUpdates}>
        <Text style={styles.buttonOutlineText}>Check for Updates</Text>
      </Pressable>

      <Text style={styles.version}>
        {getVersionString()} ({getVersionCode()})
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#d32f2f",
    marginBottom: 16,
  },
  section: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: "#d32f2f",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  stackTrace: {
    fontSize: 10,
    color: "#666",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  button: {
    backgroundColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonOutlineText: {
    color: "#2196F3",
    fontSize: 16,
    fontWeight: "600",
  },
  version: {
    textAlign: "center",
    fontSize: 11,
    color: "#999",
    marginTop: 20,
  },
});
