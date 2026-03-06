import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { useColorScheme } from "nativewind";
import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DatabaseProvider } from "@/db/provider";
import { DictDownloadGate } from "@/components/DictDownloadGate";
import { BackgroundDownloadBanner } from "@/components/BackgroundDownloadBanner";
import { UserDatabaseProvider } from "@/db/user-provider";
import { GlobalErrorHandler } from "@/components/GlobalErrorHandler";
import { useThemeEffect } from "@/lib/theme-effect";
import "../global.css";

export { ErrorBoundary } from "@/components/ErrorBoundary";

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
        <UserDatabaseProvider userId={userId!}>
          <View style={{ flex: 1 }}>
            {children}
            <BackgroundDownloadBanner />
          </View>
        </UserDatabaseProvider>
      </DictDownloadGate>
    </DatabaseProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const { colorScheme } = useColorScheme();

  useThemeEffect();

  // Prevent browser back from exiting the SPA.
  // With backBehavior="none" on tabs, tab switches use replaceState (no new
  // history entries), so browser back at the tab root would exit the app.
  // Push a guard entry after expo-router initializes so there's always
  // something to go back to, then re-push whenever the guard is hit.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Poll for expo-router's history state (it sets an `id` property).
    // Once present, push a duplicate guard entry so browser back doesn't exit.
    let cancelled = false;
    const pushGuard = () => {
      window.history.pushState(window.history.state, "", window.location.href);
    };
    const check = () => {
      if (cancelled) return;
      if (window.history.state?.id) {
        pushGuard();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
    const handler = (e: PopStateEvent) => {
      if (!e.state?.id) {
        pushGuard();
      }
    };
    window.addEventListener("popstate", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", handler);
    };
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
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  const navTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  return (
    <GlobalErrorHandler>
      <GestureHandlerRootView
        style={{
          flex: 1,
          ...(Platform.OS === "web"
            ? { maxWidth: 960, width: "100%" as any, alignSelf: "center" as const }
            : undefined),
        }}
      >
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
    </GlobalErrorHandler>
  );
}
