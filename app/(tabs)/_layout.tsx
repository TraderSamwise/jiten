import { useEffect } from "react";
import { Tabs } from "expo-router";
import { useColorScheme } from "nativewind";
import { Search, BookOpen, BookText, Settings } from "lucide-react-native";
import { useUserDb } from "@/db/user-provider";
import { useBookmarkStore } from "@/stores/bookmarks";

export { ErrorBoundary } from "@/components/ErrorBoundary";

export default function TabLayout() {
  const userDb = useUserDb();
  const loadBookmarks = useBookmarkStore((s) => s.load);

  useEffect(() => {
    if (userDb) loadBookmarks(userDb);
  }, [userDb]);

  const { colorScheme } = useColorScheme();
  const activeTint = colorScheme === "dark" ? "#fafafa" : "#18181b";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        headerShown: true,
        freezeOnBlur: true,
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
        }}
      />
    </Tabs>
  );
}
