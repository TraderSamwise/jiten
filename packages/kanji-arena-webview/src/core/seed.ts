// Shareable / replayable run seeds. A `?seed=<digits>` in the URL seeds the
// FIRST run of the page load (a seeded run you can share); later in-session runs
// re-randomize. The current run's seed is always written back to the URL so it
// can be copied and replayed.
let urlSeedConsumed = false;

export function nextRunSeed(): string {
  let seed: string | null = null;
  if (!urlSeedConsumed) {
    urlSeedConsumed = true;
    const fromUrl = new URLSearchParams(window.location.search).get("seed");
    if (fromUrl && /^\d+$/.test(fromUrl)) seed = fromUrl;
  }
  seed ??= String(Math.floor(Math.random() * 1e9));
  // Writing the seed back to the URL is a standalone-build nicety; an embedded
  // opaque-origin webview throws SecurityError here, so guard it.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", seed);
    window.history.replaceState(null, "", url);
  } catch {
    // embedded webview: URL not writable — the seed is still valid
  }
  return seed;
}
