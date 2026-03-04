import AsyncStorage from "@react-native-async-storage/async-storage";
import { atomWithStorage, createJSONStorage, unwrap } from "jotai/utils";
import { focusAtom } from "jotai-optics";

// ─── Types ───

export type ThemePreference = "system" | "light" | "dark";
export type FuriganaMode = "off" | "auto" | "on";
export type FuriganaLevel = "n5" | "n4" | "n3" | "n2" | "n1" | "nonJouyou" | "all";

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
});

export type AppSettings = typeof defaultSettings;

// ─── Merging storage adapter ───
// On read, merges stored partial into defaults so newly-added fields get defaults.

function createMergingStorage() {
  const base = createJSONStorage<AppSettings>(() => AsyncStorage);
  return {
    ...base,
    getItem: (key: string, initialValue: AppSettings) => {
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
