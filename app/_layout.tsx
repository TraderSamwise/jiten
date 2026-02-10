import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useColorScheme } from "nativewind";
import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DatabaseProvider } from "@/db/provider";
import { DictDownloadGate } from "@/components/DictDownloadGate";
import { UserDatabaseProvider } from "@/db/user-provider";
import { loadTheme, applyTheme } from "@/lib/theme";
import "../global.css";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, userId } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const onAuthScreen = segments[0] === "sign-in" || segments[0] === "sign-up";

    if (!isSignedIn && !onAuthScreen) {
      router.replace("/sign-in");
    } else if (isSignedIn && onAuthScreen) {
      router.replace("/dictionary");
    }
  }, [isSignedIn, isLoaded, segments]);

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack>
    );
  }

  return (
    <DatabaseProvider>
      <DictDownloadGate>
        <UserDatabaseProvider userId={userId!}>{children}</UserDatabaseProvider>
      </DictDownloadGate>
    </DatabaseProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const [themeReady, setThemeReady] = useState(false);
  const { colorScheme } = useColorScheme();

  useEffect(() => {
    loadTheme().then((pref) => {
      applyTheme(pref);
      setThemeReady(true);
    });
  }, []);

  // Check for OTA updates on app launch (native only)
  useEffect(() => {
    if (__DEV__ || Platform.OS === "web") return;
    (async () => {
      try {
        const Updates = await import("expo-updates");
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (e) {
        console.log("OTA update check failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && themeReady) {
      SplashScreen.hideAsync();
    }
  }, [loaded, themeReady]);

  if (!loaded || !themeReady) return null;

  const navTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          <AuthGate>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
