import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Tabs } from "expo-router";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useColorScheme } from "nativewind";
import { Search, BookOpen, BookText, GraduationCap, Settings } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { isClosedUserDbConnectionError } from "@/db/db-errors";
import { hydrateUserStores } from "@/lib/hydrate-user-stores";
import { captureException } from "@/lib/sentry";
import { webHeaderStyle } from "@/lib/navigation";
import { markSessionNavigated } from "@/lib/session-navigation";
import { SyncButton } from "@/components/SyncButton";

export { ErrorBoundary } from "@/components/ErrorBoundary";

const isWeb = Platform.OS === "web";

export default function TabLayout() {
  const userDb = useUserDb();

  useEffect(() => {
    if (!userDb) return;
    // On a user switch a slow load of the old database must not land last and
    // leave the previous account's words in the store.
    let current = true;
    hydrateUserStores(userDb).catch((err) => {
      if (!current || isClosedUserDbConnectionError(err)) return;
      console.error("[TabLayout] could not load saved words and lists", err);
      captureException(err, { tags: { type: "store-hydration" } });
    });
    return () => {
      current = false;
    };
  }, [userDb]);

  // Note: the has-navbar body class (web tab bar backdrop) is toggled in
  // AuthGate (_layout.tsx) based on auth state, not here.

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const activeTint = isDark ? "#fafafa" : "#18181b";

  const navigation = useNavigation();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        backBehavior="history"
        screenListeners={{
          tabPress: (e) => {
            // Switching tabs counts as navigating, so a first visit to the
            // dictionary this way focuses its search (see lib/session-navigation).
            markSessionNavigated();

            // If tapping the already-active tab, pop its stack to root
            const target = e.target;
            const state = navigation.getState();
            if (!state) return;
            const currentRoute = state.routes[state.index];
            if (target?.startsWith(currentRoute.name)) {
              const childState = currentRoute.state;
              if (childState && childState.index != null && childState.index > 0) {
                e.preventDefault();
                navigation.dispatch(
                  CommonActions.reset({
                    ...childState,
                    index: 0,
                    routes: [childState.routes[0]],
                  } as any),
                );
              }
            }
          },
        }}
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
          name="learn"
          options={{
            title: "Learn",
            headerShown: false,
            tabBarIcon: ({ color, size }) => <GraduationCap color={color} size={size} />,
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
      {isWeb && <SyncButton />}
    </View>
  );
}
