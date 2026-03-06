import { useEffect } from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { useColorScheme } from "nativewind";
import { Search, BookOpen, BookText, Settings } from "lucide-react-native";
import { useUserDb } from "@/db/user-provider";
import { useBookmarkStore } from "@/stores/bookmarks";
import { webHeaderStyle } from "@/lib/navigation";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const isWeb = Platform.OS === "web";

export default function TabLayout() {
  const userDb = useUserDb();
  const loadBookmarks = useBookmarkStore((s) => s.load);

  useEffect(() => {
    if (userDb) loadBookmarks(userDb);
  }, [userDb]);

  useEffect(() => {
    if (!isWeb) return;
    document.body.classList.add("has-navbar");
    return () => document.body.classList.remove("has-navbar");
  }, []);

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const activeTint = isDark ? "#fafafa" : "#18181b";

  return (
    <Tabs
      backBehavior={isWeb ? "none" : undefined}
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        headerShown: true,
        freezeOnBlur: true,
        ...(isWeb
          ? {
              tabBarPosition: "top" as any,
              tabBarStyle: {
                borderWidth: 1,
                borderColor: isDark ? "hsl(240,3.7%,15.9%)" : "hsl(240,5.9%,90%)",
                borderRadius: 12,
                marginHorizontal: 8,
                marginTop: 8,
                marginBottom: 16,
                paddingTop: 10,
                paddingBottom: 10,
                overflow: "hidden",
              },
              tabBarLabelStyle: {
                fontSize: 13,
                fontWeight: "500" as const,
              },
            }
          : undefined),
      }}
    >
      <Tabs.Screen
        name="dictionary"
        options={{
          title: "Dictionary",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          title: "Lists",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reader"
        options={{
          title: "Reader",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <BookText color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
          headerStyle: webHeaderStyle,
        }}
      />
    </Tabs>
  );
}
