import {
  View,
  ScrollView,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
} from "react-native";
import { getVersionString, getVersionCode } from "@/lib/version";

interface ErrorScreenProps {
  source: string;
  message: string;
  stack?: string;
  primaryAction: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
}

export function ErrorScreen({
  source,
  message,
  stack,
  primaryAction,
  secondaryAction,
}: ErrorScreenProps) {
  const dark = useColorScheme() === "dark";
  const s = dark ? darkStyles : styles;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>Something went wrong</Text>

      <View style={s.section}>
        <Text style={s.sectionTitle}>{source}</Text>
        <Text style={s.errorMessage}>{message}</Text>
      </View>

      <Pressable style={s.button} onPress={primaryAction.onPress}>
        <Text style={s.buttonText}>{primaryAction.label}</Text>
      </Pressable>

      {secondaryAction && (
        <Pressable style={s.buttonOutline} onPress={secondaryAction.onPress}>
          <Text style={s.buttonOutlineText}>{secondaryAction.label}</Text>
        </Pressable>
      )}

      <Text style={s.version}>
        {getVersionString()} ({getVersionCode()})
      </Text>

      {stack && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Stack Trace</Text>
          <Text style={s.stackTrace}>{stack}</Text>
        </View>
      )}
    </ScrollView>
  );
}

export async function checkForUpdates(fallback: () => void) {
  if (Platform.OS === "web" || __DEV__) {
    fallback();
    return;
  }
  try {
    const Updates = await import("expo-updates");
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } else {
      fallback();
    }
  } catch {
    fallback();
  }
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
    marginBottom: 16,
  },
});

const darkStyles = StyleSheet.create({
  ...styles,
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  section: { marginBottom: 12, padding: 12, backgroundColor: "#1a1a1a", borderRadius: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#999", marginBottom: 4 },
  errorMessage: {
    fontSize: 14,
    color: "#ef5350",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  stackTrace: {
    fontSize: 10,
    color: "#999",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  title: { fontSize: 22, fontWeight: "700", color: "#ef5350", marginBottom: 16 },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonOutlineText: { color: "#42a5f5", fontSize: 16, fontWeight: "600" },
  version: { textAlign: "center", fontSize: 11, color: "#666", marginTop: 20, marginBottom: 16 },
});
