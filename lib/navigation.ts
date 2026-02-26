import { useCallback } from "react";
import { useRouter, useNavigation } from "expo-router";

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
    if (state.index > 0) {
      router.back();
    } else {
      router.replace(fallback);
    }
  }, [router, navigation, fallback]);
}
