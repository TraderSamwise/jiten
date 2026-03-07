import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useColorScheme } from "nativewind";
import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DatabaseProvider } from "@/db/provider";
import { DictDownloadGate } from "@/components/DictDownloadGate";
import { BackgroundDownloadBanner } from "@/components/BackgroundDownloadBanner";
import { UserDatabaseProvider } from "@/db/user-provider";
import { SyncProvider, useSync } from "@/db/sync-provider";
import { GlobalErrorHandler } from "@/components/GlobalErrorHandler";
import { useThemeEffect } from "@/lib/theme-effect";
import { confirm } from "@/lib/confirm";
import "../global.css";

export { ErrorBoundary } from "@/components/ErrorBoundary";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

function ReconciliationCheck() {
  const { needsReconciliation, resolveReconciliation } = useSync();
  const prompted = useRef(false);

  useEffect(() => {
    if (!needsReconciliation || prompted.current) return;
    prompted.current = true;

    confirm(
      "Different account",
      "This device has data from a different account. Signing in will replace local data with your cloud data. Continue?",
    ).then((proceed) => {
      resolveReconciliation(proceed);
      prompted.current = false;
    });
  }, [needsReconciliation, resolveReconciliation]);

  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, userId, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [authTimedOut, setAuthTimedOut] = useState(false);

  // Fall back to unsigned mode if Clerk fails to load within 5 seconds
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  // Redirect signed-in users away from auth screens
  useEffect(() => {
    if (!isLoaded) return;
    const onAuthScreen = segments[0] === "sign-in" || segments[0] === "sign-up";
    if (isSignedIn && onAuthScreen) {
      router.replace("/dictionary");
    }
  }, [isSignedIn, isLoaded, segments]);

  // Always add has-navbar on web once loaded (app tree is always mounted)
  useEffect(() => {
    if (Platform.OS !== "web" || !isLoaded) return;
    document.body.classList.add("has-navbar");
  }, [isLoaded]);

  if (!isLoaded && !authTimedOut) return null;

  const effectiveUserId = userId ?? "local";

  return (
    <DatabaseProvider>
      <DictDownloadGate>
        <UserDatabaseProvider userId={effectiveUserId}>
          <SyncProvider userId={effectiveUserId} onSignOut={signOut}>
            <ReconciliationCheck />
            <View style={{ flex: 1 }}>
              {children}
              <BackgroundDownloadBanner />
            </View>
          </SyncProvider>
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
            <AppShell>
              <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="sign-in"
                  options={{ headerShown: false, presentation: "modal" }}
                />
                <Stack.Screen
                  name="sign-up"
                  options={{ headerShown: false, presentation: "modal" }}
                />
              </Stack>
            </AppShell>
          </AuthProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </GlobalErrorHandler>
  );
}
