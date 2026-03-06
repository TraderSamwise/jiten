import { useEffect, useRef, useState, useCallback } from "react";
import { isNativeModuleAvailable } from "@/lib/native-guard";

// Cache the lazy-load result so we only attempt once.
// requireNativeModule() throws at module-evaluation time when the native
// binary doesn't include ExpoSpeechRecognition. We guard with
// isNativeModuleAvailable before ever touching the package.
let _moduleChecked = false;
let _module: any | null = null;
let _emitter: any | null = null;

function loadModule() {
  if (_moduleChecked) return;
  _moduleChecked = true;
  if (!isNativeModuleAvailable("ExpoSpeechRecognition")) return;
  try {
    const pkg = require("@jamsch/expo-speech-recognition");
    _module = pkg.ExpoSpeechRecognitionModule;
    _emitter = pkg.ExpoSpeechRecognitionModuleEmitter;
  } catch {
    _module = null;
    _emitter = null;
  }
}

function getModule() {
  loadModule();
  return _module;
}

function getEmitter() {
  loadModule();
  return _emitter;
}

/** Request microphone + speech recognition permissions. Returns true if granted. */
export async function requestVoicePermissions(): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  const result = await mod.requestPermissionsAsync();
  return result.granted;
}

/** Start listening for speech in the given locale. */
export function startVoiceListening(locale = "ja-JP"): void {
  getModule()?.start({
    lang: locale,
    interimResults: false,
    continuous: false,
    requiresOnDeviceRecognition: false,
  });
}

/** Stop listening. */
export function stopVoiceListening(): void {
  try {
    getModule()?.abort();
  } catch {
    // Ignore if not running
  }
}

/** Returns true if the native speech recognition module is available. */
export function isVoiceRecognitionAvailable(): boolean {
  return getModule() != null;
}

/**
 * React hook for voice recognition in components.
 *
 * When `enabled` is true, starts listening and calls `onResult` with each
 * recognized transcript. Auto-restarts after each utterance ends.
 * Cleans up on unmount or when `enabled` flips to false.
 *
 * Safe to call even if the native module isn't installed — just returns
 * isListening: false and never fires.
 */
export function useVoiceRecognition(options: {
  enabled: boolean;
  onResult: (transcript: string) => void;
}): { isListening: boolean } {
  const { enabled, onResult } = options;
  const [isListening, setIsListening] = useState(false);
  const enabledRef = useRef(enabled);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    enabledRef.current = enabled;
    onResultRef.current = onResult;
  });

  const startListening = useCallback(() => {
    if (!enabledRef.current) return;
    startVoiceListening("ja-JP");
  }, []);

  useEffect(() => {
    const emitter = getEmitter();
    if (!emitter) return;

    const subs = [
      emitter.addListener("start", () => {
        if (enabledRef.current) setIsListening(true);
      }),
      emitter.addListener("result", (ev: { results?: { transcript?: string }[] }) => {
        if (!enabledRef.current) return;
        const transcript = ev.results?.[0]?.transcript;
        if (transcript) onResultRef.current(transcript);
      }),
      emitter.addListener("end", () => {
        setIsListening(false);
        if (enabledRef.current) setTimeout(startListening, 300);
      }),
      emitter.addListener("error", () => {
        setIsListening(false);
        if (enabledRef.current) setTimeout(startListening, 500);
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [startListening]);

  useEffect(() => {
    if (!getModule()) return;
    if (enabled) {
      startListening();
    } else {
      stopVoiceListening();
      setIsListening(false);
    }
    return () => {
      stopVoiceListening();
      setIsListening(false);
    };
  }, [enabled, startListening]);

  return { isListening };
}
