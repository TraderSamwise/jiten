import AsyncStorage from "@react-native-async-storage/async-storage";
import { atomWithStorage, createJSONStorage, unwrap } from "jotai/utils";
import { focusAtom } from "jotai-optics";

// ─── Types ───

export type ThemePreference = "system" | "light" | "dark";
export type FuriganaMode = "off" | "auto" | "on";
export type FuriganaLevel = "n5" | "n4" | "n3" | "n2" | "n1" | "nonJouyou" | "all";
export type ConnectGameMode = "timed" | "zen";
export type TimedDuration = 60 | 90 | 120;
export type SpeedPreset = "easy" | "normal" | "hard";
export type WordFilterMode = "review" | "learn" | "all";
export type ConnectBubbleKinds = { kanji: boolean; reading: boolean; meaning: boolean };

// ─── Defaults ───

export const defaultFuriganaLevels: Record<FuriganaLevel, boolean> = {
  n5: false,
  n4: false,
  n3: false,
  n2: false,
  n1: false,
  nonJouyou: false,
  all: false,
};

export const defaultSettings = Object.freeze({
  theme: "system" as ThemePreference,
  typingFuriganaMode: "auto" as FuriganaMode,
  typingShowPitch: true as boolean,
  typingPlayAudio: false as boolean,
  readerFuriganaLevels: defaultFuriganaLevels as Record<FuriganaLevel, boolean>,
  readerPageAnimations: true as boolean,
  connectGameMode: "timed" as ConnectGameMode,
  connectTimedDuration: 90 as TimedDuration,
  connectSpeedPreset: "normal" as SpeedPreset,
  connectBubbleKinds: { kanji: true, reading: true, meaning: false } as ConnectBubbleKinds,
  typingWordFilter: "all" as WordFilterMode,
});

export type AppSettings = typeof defaultSettings;

// ─── Merging storage adapter ───
// On read, merges stored partial into defaults so newly-added fields get defaults.

// SSR-safe no-op storage for server-side rendering (Vercel static export).
// AsyncStorage's web shim accesses `window` at call time, which crashes in Node.
const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const isServer = typeof window === "undefined";

function createMergingStorage() {
  const base = createJSONStorage<AppSettings>(() => (isServer ? noopStorage : AsyncStorage) as any);
  return {
    ...base,
    getItem: (key: string, initialValue: AppSettings) => {
      if (isServer) return Promise.resolve(initialValue);
      const stored = base.getItem(key, initialValue);
      if (stored instanceof Promise) {
        return stored.then((v) => ({ ...initialValue, ...v }));
      }
      return { ...initialValue, ...stored };
    },
  };
}

// ─── Atoms ───

const asyncSettingsAtom = atomWithStorage<AppSettings>(
  "settings",
  defaultSettings,
  createMergingStorage(),
  { getOnInit: true },
);

export const settingsAtom = unwrap(asyncSettingsAtom, (prev) => prev ?? defaultSettings);

// ─── Focused atoms ───

export const themeAtom = focusAtom(settingsAtom, (o) => o.prop("theme"));
export const typingFuriganaModeAtom = focusAtom(settingsAtom, (o) => o.prop("typingFuriganaMode"));
export const typingShowPitchAtom = focusAtom(settingsAtom, (o) => o.prop("typingShowPitch"));
export const typingPlayAudioAtom = focusAtom(settingsAtom, (o) => o.prop("typingPlayAudio"));
export const readerFuriganaLevelsAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerFuriganaLevels"),
);
export const readerPageAnimationsAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerPageAnimations"),
);
export const connectGameModeAtom = focusAtom(settingsAtom, (o) => o.prop("connectGameMode"));
export const connectTimedDurationAtom = focusAtom(settingsAtom, (o) =>
  o.prop("connectTimedDuration"),
);
export const connectSpeedPresetAtom = focusAtom(settingsAtom, (o) => o.prop("connectSpeedPreset"));
export const connectBubbleKindsAtom = focusAtom(settingsAtom, (o) => o.prop("connectBubbleKinds"));
export const typingWordFilterAtom = focusAtom(settingsAtom, (o) => o.prop("typingWordFilter"));
