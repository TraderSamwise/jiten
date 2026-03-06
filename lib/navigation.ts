import React, { useCallback } from "react";
import { useRouter, useNavigation, usePathname } from "expo-router";
import { HeaderBackButton } from "@react-navigation/elements";

/**
 * Returns a goBack function that checks the current stack's state.
 * If there's a real route to pop to within the stack, it calls router.back().
 * Otherwise, it replaces with the fallback route (the tab's root screen).
 *
 * This handles web page refreshes where canGoBack() is true (because the
 * parent tabs navigator can go back) but the current stack has only one route,
 * so back() would escape to a different tab instead of the tab root.
 */
export function useSafeGoBack(fallback: string) {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState();
    if (state && state.index > 0) {
      router.back();
    } else {
      router.replace(fallback as any);
    }
  }, [router, navigation, fallback]);
}

/**
 * Back button component for use in tab stack layouts.
 * Uses the native HeaderBackButton styling, with useSafeGoBack fallback
 * so it works even after a web page refresh (no stack history).
 */
export function SafeBackButton({ fallback, tintColor }: { fallback: string; tintColor?: string }) {
  const goBack = useSafeGoBack(fallback);
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
