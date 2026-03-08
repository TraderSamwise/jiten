import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
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
import { SyncChoiceModal } from "@/components/SyncChoiceModal";
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

function FirstSyncCheck() {
  const { needsFirstSyncChoice, resolveFirstSyncChoice } = useSync();

  return <SyncChoiceModal visible={needsFirstSyncChoice} onChoice={resolveFirstSyncChoice} />;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, userId, signOut, getToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [authTimedOut, setAuthTimedOut] = useState(false);

  // Fall back to unsigned mode if Clerk fails to load within 5 seconds
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  const onAuthScreen = segments[0] === "sign-in" || segments[0] === "sign-up";

  // Redirect signed-in users away from auth screens
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && onAuthScreen) {
      router.replace("/dictionary");
    }
  }, [isSignedIn, isLoaded, onAuthScreen]);
  useEffect(() => {
    if (Platform.OS !== "web" || !isLoaded) return;
    if (onAuthScreen) {
      document.body.classList.remove("has-navbar");
    } else {
      document.body.classList.add("has-navbar");
    }
  }, [isLoaded, onAuthScreen]);

  if (!isLoaded && !authTimedOut) return null;

  const effectiveUserId = userId ?? "local";

  return (
    <DatabaseProvider>
      <DictDownloadGate>
        <UserDatabaseProvider userId={effectiveUserId}>
          <SyncProvider userId={effectiveUserId} onSignOut={signOut} getToken={getToken}>
            <ReconciliationCheck />
            <FirstSyncCheck />
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
  const router = useRouter();

  useThemeEffect();

  // Intercept ALL browser history navigation (back/forward) in capture phase,
  // BEFORE expo-router's popstate handler. Expo-router tries to restore stale
  // React Navigation state from history entries, causing full page reloads when
  // the state is out of sync (e.g., after router.replace()-based back navigation).
  //
  // Instead, we prevent expo-router from processing the event and use
  // router.replace() to cleanly navigate to the URL the browser already moved to.
  // This also handles the SPA exit guard (entries without expo-router state).
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    if (Platform.OS !== "web") return;

    // Wait for expo-router to initialize (sets `id` in history state),
    // then push a guard entry so browser back can't exit the SPA.
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      if (window.history.state?.id) {
        window.history.pushState(window.history.state, "", window.location.href);
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);

    const handler = (e: PopStateEvent) => {
      // No expo-router state → SPA exit guard: re-push to prevent leaving
      if (!e.state?.id) {
        window.history.pushState(window.history.state, "", window.location.href);
        return;
      }

      // Has expo-router state → browser back/forward to a history entry.
      // Stop expo-router from restoring potentially stale state.
      e.stopImmediatePropagation();

      // Navigate to the URL the browser already moved to, using replace
      // so we don't add duplicate history entries.
      const target = window.location.pathname + window.location.search;
      routerRef.current.replace(target as any);
    };
    // Capture phase fires before expo-router's bubble-phase listener
    window.addEventListener("popstate", handler, { capture: true });
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", handler, { capture: true });
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
