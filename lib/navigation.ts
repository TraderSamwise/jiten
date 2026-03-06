import React, { useCallback } from "react";
import { Platform } from "react-native";
import { useRouter, useNavigation, usePathname } from "expo-router";
import { HeaderBackButton } from "@react-navigation/elements";

/** Transparent header background on web so the navbar backdrop shows through */
export const webHeaderStyle =
  Platform.OS === "web" ? ({ backgroundColor: "transparent" } as const) : undefined;

/** className fragment: includes bg-background on native, omits it on web for transparent headers */
export const headerBgClass = Platform.OS === "web" ? "" : "bg-background";

/** Top padding for screens with headerShown: false that render their own header on web */
export const WEB_CUSTOM_HEADER_TOP = 7;

/** Navigator backdrop colors — matches global.css body.has-navbar::before */
export const WEB_BACKDROP_COLORS = {
  light: "rgb(242, 242, 242)",
  dark: "rgb(1, 1, 1)",
} as const;

/**
 * Build a URL path from a route's name and params.
 * Used on web to compute the previous route's path for router.replace().
 */
function buildRoutePath(
  route: { name: string; params?: Record<string, any> },
  fallback: string,
): string {
  if (route.name === "index") return fallback;
  const params = { ...route.params };

  // Substitute [param] segments with actual values
  const path = route.name.replace(/\[(\w+)\]/g, (_, key) => {
    const val = params[key];
    delete params[key];
    return encodeURIComponent(String(val ?? ""));
  });

  // Remove React Navigation internal params
  delete params.screen;
  delete params.initial;
  delete params.params;

  // Remaining params become query string
  const entries = Object.entries(params).filter(([, v]) => v != null);
  const query = entries.length
    ? "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
    : "";

  return `${fallback}/${path}${query}`;
}

/**
 * Returns a goBack function that checks the current stack's state.
 * On native, pops the stack or replaces with fallback.
 * On web, uses router.replace() to avoid cross-tab browser history issues.
 */
export function useSafeGoBack(fallback: string) {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState();

    if (Platform.OS !== "web") {
      // Native: unchanged
      if (state && state.index > 0) {
        router.back();
      } else {
        router.replace(fallback as any);
      }
      return;
    }

    // Web: never use router.back() — avoid cross-tab browser history
    if (!state || state.index === 0) {
      router.replace(fallback as any);
      return;
    }

    const prevRoute = state.routes[state.index - 1];
    const targetPath = buildRoutePath(prevRoute, fallback);
    const currentRoute = state.routes[state.index];
    const currentPath = buildRoutePath(currentRoute, fallback);

    if (targetPath === currentPath) {
      // Phantom duplicate — already at target, no-op
      return;
    }

    router.replace(targetPath as any);
  }, [router, navigation, fallback]);
}

/**
 * Back button component for use in tab stack layouts.
 * Uses the native HeaderBackButton styling, with useSafeGoBack fallback
 * so it works even after a web page refresh (no stack history).
 * On web, hides when phantom duplicates make back a no-op.
 */
export function SafeBackButton({ fallback, tintColor }: { fallback: string; tintColor?: string }) {
  const goBack = useSafeGoBack(fallback);
  const navigation = useNavigation();
  const state = navigation.getState();

  // On web, hide when phantom duplicates make back a no-op
  if (Platform.OS === "web" && state) {
    if (state.index === 0) return null;
    const prev = state.routes[state.index - 1];
    const curr = state.routes[state.index];
    if (buildRoutePath(prev, fallback) === buildRoutePath(curr, fallback)) return null;
  }

  return React.createElement(HeaderBackButton, { onPress: goBack, tintColor });
}

function useTabPrefix(): string {
  const pathname = usePathname();
  if (pathname.startsWith("/lists")) return "/lists";
  if (pathname.startsWith("/reader")) return "/reader";
  return "/dictionary";
}

/**
 * Tab-aware router for shared screens (kanji detail, word detail).
 * Use pushKanji/pushWord to stay within the current tab's stack.
 * Use router.push() directly for intentional cross-tab navigation.
 */
export function useTabRouter() {
  const router = useRouter();
  const prefix = useTabPrefix();
  return {
    ...router,
    pushKanji: (literal: string) =>
      router.push(`${prefix}/kanji/${encodeURIComponent(literal)}` as any),
    pushWord: (id: number) => router.push(`${prefix}/word/${id}` as any),
  };
}
