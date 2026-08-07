/**
 * Has the user navigated since the app started?
 *
 * The dictionary search raises the keyboard when you come *back* to it, but not
 * when the app opens onto it — arriving there by launching the app isn't the same
 * intent as returning to it. Module scope is the session: a cold start (or a web
 * reload) begins with this false, and it stays true once flipped.
 */
let navigated = false;

export function markSessionNavigated(): void {
  navigated = true;
}

export function hasNavigatedThisSession(): boolean {
  return navigated;
}

/** Test seam — module state would otherwise leak between cases. */
export function resetSessionNavigation(): void {
  navigated = false;
}
