import AsyncStorage from "@react-native-async-storage/async-storage";
import { atomWithStorage, createJSONStorage, unwrap } from "jotai/utils";
import { focusAtom } from "jotai-optics";

// ─── Types ───

export type ThemePreference = "system" | "light" | "dark";
export type FuriganaMode = "off" | "auto" | "on";

// ─── Defaults ───

export const defaultSettings = Object.freeze({
  theme: "system" as ThemePreference,
  typingFuriganaMode: "auto" as FuriganaMode,
  typingShowPitch: true as boolean,
  typingPlayAudio: false as boolean,
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
