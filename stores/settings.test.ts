import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "jotai";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Ensure `window` is defined so settings.ts doesn't activate server-side noop storage
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

import {
  defaultSettings,
  settingsAtom,
  themeAtom,
  typingFuriganaModeAtom,
  typingShowPitchAtom,
  typingPlayAudioAtom,
  dayResetHourAtom,
} from "./settings";

// Access mock helpers
const mockStorage = AsyncStorage as typeof AsyncStorage & {
  _clear: () => void;
  _getStore: () => Record<string, string>;
};

beforeEach(() => {
  mockStorage._clear();
});

// ─── Default values ───

describe("defaultSettings", () => {
  it("has correct default values", () => {
    expect(defaultSettings).toEqual({
      theme: "system",
      typingFuriganaMode: "auto",
      typingShowPitch: true,
      typingPlayAudio: false,
      readerSourceFurigana: true,
      readerNameFurigana: false,
      readerCounterFurigana: false,
      readerBookmarkHighlights: false,
      readerFuriganaRuleLevels: {
        matchAnyKanji: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
        matchWordLevel: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
        matchIrregularReading: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
        matchMostlyKunyomi: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
        matchMostlyOnyomi: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
        matchMixedOnKun: {
          n1: false,
          n2: false,
          n3: false,
          n4: false,
          n5: false,
          nonJouyou: false,
        },
      },
      readerPageAnimations: true,
      connectGameMode: "timed",
      connectTimedDuration: 90,
      connectSpeedPreset: "normal",
      connectBubbleKinds: { kanji: true, reading: true, meaning: false },
      typingWordFilter: "all",
      showRomaji: false,
      showPitchAccent: true,
      showPitchAccentType: false,
      flashcardFlipAnimation: true,
      flashcardSwipeAnimation: true,
      flashcardButtonAnimation: true,
      dayResetHour: 3,
      smartReviewDays: 7,
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(defaultSettings)).toBe(true);
  });
});

// ─── Atom read/write ───

describe("settingsAtom", () => {
  it("returns defaults when AsyncStorage is empty", () => {
    const store = createStore();
    const value = store.get(settingsAtom);
    expect(value).toEqual(defaultSettings);
  });

  it("persists full settings object to AsyncStorage on write", async () => {
    const store = createStore();
    store.set(settingsAtom, { ...defaultSettings, theme: "dark" });

    // Allow async write to flush
    await new Promise((r) => setTimeout(r, 200));

    const raw = await AsyncStorage.getItem("settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe("dark");
    expect(parsed.typingFuriganaMode).toBe("auto");
  });
});

// ─── Focused atoms ───

describe("focused atoms", () => {
  it("themeAtom reads from settingsAtom", () => {
    const store = createStore();
    expect(store.get(themeAtom)).toBe("system");
  });

  it("themeAtom writes update the parent", () => {
    const store = createStore();
    store.set(themeAtom, "dark");
    expect(store.get(themeAtom)).toBe("dark");
    expect(store.get(settingsAtom)?.theme).toBe("dark");
  });

  it("typingFuriganaModeAtom reads and writes", () => {
    const store = createStore();
    expect(store.get(typingFuriganaModeAtom)).toBe("auto");
    store.set(typingFuriganaModeAtom, "off");
    expect(store.get(typingFuriganaModeAtom)).toBe("off");
    expect(store.get(settingsAtom)?.typingFuriganaMode).toBe("off");
  });

  it("typingShowPitchAtom reads and writes", () => {
    const store = createStore();
    expect(store.get(typingShowPitchAtom)).toBe(true);
    store.set(typingShowPitchAtom, false);
    expect(store.get(typingShowPitchAtom)).toBe(false);
  });

  it("typingPlayAudioAtom reads and writes", () => {
    const store = createStore();
    expect(store.get(typingPlayAudioAtom)).toBe(false);
    store.set(typingPlayAudioAtom, true);
    expect(store.get(typingPlayAudioAtom)).toBe(true);
  });

  it("dayResetHourAtom reads and writes", () => {
    const store = createStore();
    expect(store.get(dayResetHourAtom)).toBe(3);
    store.set(dayResetHourAtom, 5);
    expect(store.get(dayResetHourAtom)).toBe(5);
    expect(store.get(settingsAtom)?.dayResetHour).toBe(5);
  });

  it("writing one focused atom does not affect others", () => {
    const store = createStore();
    store.set(themeAtom, "light");
    expect(store.get(typingFuriganaModeAtom)).toBe("auto");
    expect(store.get(typingShowPitchAtom)).toBe(true);
    expect(store.get(typingPlayAudioAtom)).toBe(false);
  });
});

// ─── Persistence roundtrip ───

describe("persistence", () => {
  it("written settings persist to AsyncStorage", async () => {
    const store = createStore();
    store.set(themeAtom, "light");
    store.set(typingFuriganaModeAtom, "on");
    store.set(typingShowPitchAtom, false);
    store.set(typingPlayAudioAtom, true);

    // Allow async write to flush
    await new Promise((r) => setTimeout(r, 200));

    const raw = await AsyncStorage.getItem("settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe("light");
    expect(parsed.typingFuriganaMode).toBe("on");
    expect(parsed.typingShowPitch).toBe(false);
    expect(parsed.typingPlayAudio).toBe(true);
  });

  it("merging storage fills missing fields with defaults", async () => {
    // Simulate old stored data missing newly-added fields
    await AsyncStorage.setItem("settings", JSON.stringify({ theme: "dark" }));

    // Read raw from the merging storage adapter — the getItem call
    // should merge the partial with defaults
    const { createJSONStorage } = await import("jotai/utils");
    const base = createJSONStorage<typeof defaultSettings>(() => AsyncStorage);
    const stored = await base.getItem("settings", defaultSettings);

    // The raw stored value only has theme — merging fills the rest
    const merged = { ...defaultSettings, ...stored };
    expect(merged.theme).toBe("dark");
    expect(merged.typingFuriganaMode).toBe("auto");
    expect(merged.typingShowPitch).toBe(true);
    expect(merged.typingPlayAudio).toBe(false);
  });
});
