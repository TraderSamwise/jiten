import { useEffect, useRef, useState, useCallback } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "@jamsch/expo-speech-recognition";

/** Request microphone + speech recognition permissions. Returns true if granted. */
export async function requestVoicePermissions(): Promise<boolean> {
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return result.granted;
}

/** Start listening for speech in the given locale. */
export function startVoiceListening(locale = "ja-JP"): void {
  ExpoSpeechRecognitionModule.start({
    lang: locale,
    interimResults: false,
    continuous: false,
    requiresOnDeviceRecognition: false,
  });
}

/** Stop listening (attempts to return a final result). */
export function stopVoiceListening(): void {
  ExpoSpeechRecognitionModule.abort();
}

/**
 * React hook for voice recognition in components.
 *
 * When `enabled` is true, starts listening and calls `onResult` with each
 * recognized transcript. Auto-restarts after each utterance ends.
 * Cleans up on unmount or when `enabled` flips to false.
 */
export function useVoiceRecognition(options: {
  enabled: boolean;
  onResult: (transcript: string) => void;
}): { isListening: boolean } {
  const { enabled, onResult } = options;
  const [isListening, setIsListening] = useState(false);
  const enabledRef = useRef(enabled);
  const onResultRef = useRef(onResult);
  enabledRef.current = enabled;
  onResultRef.current = onResult;

  const startListening = useCallback(() => {
    if (!enabledRef.current) return;
    startVoiceListening("ja-JP");
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (enabledRef.current) setIsListening(true);
  });

  useSpeechRecognitionEvent("result", (ev) => {
    if (!enabledRef.current) return;
    // Take the best transcript from the first result
    const transcript = ev.results[0]?.transcript;
    if (transcript) {
      onResultRef.current(transcript);
    }
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    // Auto-restart if still enabled (continuous listening across utterances)
    if (enabledRef.current) {
      // Small delay to avoid rapid restart loops
      setTimeout(startListening, 300);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    setIsListening(false);
    // Restart on error if still enabled
    if (enabledRef.current) {
      setTimeout(startListening, 500);
    }
  });

  useEffect(() => {
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
