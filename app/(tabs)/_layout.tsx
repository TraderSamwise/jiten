import { useEffect } from "react";
import { Tabs } from "expo-router";
import { Search, BookOpen, GraduationCap, Settings } from "lucide-react-native";
import { useUserDb } from "@/db/user-provider";
import { useBookmarkStore } from "@/stores/bookmarks";

export default function TabLayout() {
  const userDb = useUserDb();
  const loadBookmarks = useBookmarkStore((s) => s.load);

  useEffect(() => {
    if (userDb) loadBookmarks(userDb);
  }, [userDb]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#18181b",
        headerShown: true,
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
          tabBarIcon: ({ color, size }) => (
            <BookOpen color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="flashcards"
        options={{
          title: "Study",
          tabBarIcon: ({ color, size }) => (
            <GraduationCap color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
