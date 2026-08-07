import AsyncStorage from "@react-native-async-storage/async-storage";
import { atomWithStorage, createJSONStorage, unwrap } from "jotai/utils";
import { focusAtom } from "jotai-optics";
import {
  defaultReaderFuriganaRuleLevels,
  type FuriganaMatchLevel,
  type ReaderFuriganaRule,
} from "@tradersamwise/jiten-reader-react-native";

// ─── Types ───

export type ThemePreference = "system" | "light" | "dark";
export type FuriganaMode = "off" | "auto" | "on";
export type {
  FuriganaMatchLevel,
  ReaderFuriganaRule,
} from "@tradersamwise/jiten-reader-react-native";
export type ConnectGameMode = "timed" | "survival" | "zen";
export type TimedDuration = 60 | 90 | 120;
export type SpeedPreset = "easy" | "normal" | "hard";
export type WordFilterMode = "review" | "learn" | "all";
export type ConnectBubbleKinds = { kanji: boolean; reading: boolean; meaning: boolean };

// ─── Defaults ───

export {
  defaultFuriganaMatchLevels,
  defaultReaderFuriganaRuleLevels,
} from "@tradersamwise/jiten-reader-react-native";

export const defaultSettings = Object.freeze({
  theme: "system" as ThemePreference,
  typingFuriganaMode: "auto" as FuriganaMode,
  typingShowPitch: true as boolean,
  typingPlayAudio: false as boolean,
  readerSourceFurigana: true as boolean,
  readerNameFurigana: false as boolean,
  readerCounterFurigana: false as boolean,
  readerBookmarkHighlights: false as boolean,
  readerFuriganaRuleLevels: defaultReaderFuriganaRuleLevels as Record<
    ReaderFuriganaRule,
    Record<FuriganaMatchLevel, boolean>
  >,
  readerPageAnimations: true as boolean,
  connectGameMode: "timed" as ConnectGameMode,
  connectTimedDuration: 90 as TimedDuration,
  connectSpeedPreset: "normal" as SpeedPreset,
  connectBubbleKinds: { kanji: true, reading: true, meaning: false } as ConnectBubbleKinds,
  typingWordFilter: "all" as WordFilterMode,
  contextWordFilter: "all" as WordFilterMode,
  contextShowEnglish: true as boolean,
  contextPlayAudio: false as boolean,
  showRomaji: false as boolean,
  showPitchAccent: true as boolean,
  showPitchAccentType: false as boolean,
  flashcardFlipAnimation: true as boolean,
  flashcardSwipeAnimation: true as boolean,
  flashcardButtonAnimation: true as boolean,
  dayResetHour: 3 as number,
  smartReviewDays: 7 as number,
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

function isServer() {
  return typeof window === "undefined";
}

function createMergingStorage() {
  const base = createJSONStorage<AppSettings>(
    () => (isServer() ? noopStorage : AsyncStorage) as any,
  );
  return {
    ...base,
    getItem: (key: string, initialValue: AppSettings) => {
      if (isServer()) return Promise.resolve(initialValue);
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
export const readerSourceFuriganaAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerSourceFurigana"),
);
export const readerNameFuriganaAtom = focusAtom(settingsAtom, (o) => o.prop("readerNameFurigana"));
export const readerCounterFuriganaAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerCounterFurigana"),
);
export const readerBookmarkHighlightsAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerBookmarkHighlights"),
);
export const readerFuriganaRuleLevelsAtom = focusAtom(settingsAtom, (o) =>
  o.prop("readerFuriganaRuleLevels"),
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
export const contextWordFilterAtom = focusAtom(settingsAtom, (o) => o.prop("contextWordFilter"));
export const contextShowEnglishAtom = focusAtom(settingsAtom, (o) => o.prop("contextShowEnglish"));
export const contextPlayAudioAtom = focusAtom(settingsAtom, (o) => o.prop("contextPlayAudio"));
export const showRomajiAtom = focusAtom(settingsAtom, (o) => o.prop("showRomaji"));
export const showPitchAccentAtom = focusAtom(settingsAtom, (o) => o.prop("showPitchAccent"));
export const showPitchAccentTypeAtom = focusAtom(settingsAtom, (o) =>
  o.prop("showPitchAccentType"),
);
export const flashcardFlipAnimationAtom = focusAtom(settingsAtom, (o) =>
  o.prop("flashcardFlipAnimation"),
);
export const flashcardSwipeAnimationAtom = focusAtom(settingsAtom, (o) =>
  o.prop("flashcardSwipeAnimation"),
);
export const flashcardButtonAnimationAtom = focusAtom(settingsAtom, (o) =>
  o.prop("flashcardButtonAnimation"),
);
export const dayResetHourAtom = focusAtom(settingsAtom, (o) => o.prop("dayResetHour"));
export const smartReviewDaysAtom = focusAtom(settingsAtom, (o) => o.prop("smartReviewDays"));
