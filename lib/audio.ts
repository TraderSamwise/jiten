/**
 * Cross-platform audio playback from SQLite BLOBs.
 *
 * Queries word_audio table, plays MP3 via expo-audio.
 * Singleton player instance — stops previous before playing new.
 * Gracefully degrades if native audio module is unavailable.
 */

import { Platform } from "react-native";
import { isNativeModuleAvailable } from "@/lib/native-guard";
import type { SQLiteDatabase } from "expo-sqlite";

// Lazy-load expo-audio to avoid crashes when native module isn't linked
let _audioChecked = false;
type AudioPlayer = { play: () => void; remove: () => void };
let _createAudioPlayer: ((uri: string) => AudioPlayer) | null = null;

function getCreateAudioPlayer() {
  if (_audioChecked) return _createAudioPlayer;
  _audioChecked = true;
  if (!isNativeModuleAvailable("ExpoAudio")) return null;
  try {
    _createAudioPlayer = require("expo-audio").createAudioPlayer;
  } catch {
    _createAudioPlayer = null;
  }
  return _createAudioPlayer;
}

let currentPlayer: AudioPlayer | null = null;
let currentUri: string | null = null;

/**
 * Play audio for a dictionary entry.
 * Returns true if audio was found and playback started, false otherwise.
 */
export async function playEntryAudio(db: SQLiteDatabase, entryId: number): Promise<boolean> {
  try {
    const create = getCreateAudioPlayer();
    if (!create) return false;

    const row = await db.getFirstAsync<{ audio: ArrayBuffer; format: string }>(
      "SELECT audio, format FROM word_audio WHERE entry_id = ? LIMIT 1",
      [entryId],
    );

    if (!row?.audio) return false;

    stopAudio();

    const uri = await blobToUri(row.audio);
    const player = create(uri);
    currentPlayer = player;
    currentUri = uri;

    player.play();
    return true;
  } catch (err) {
    console.warn("[Audio] Playback error:", err);
    return false;
  }
}

/** Stop any currently playing audio and release resources. */
export function stopAudio(): void {
  if (currentPlayer) {
    try {
      currentPlayer.remove();
    } catch {
      // Already removed
    }
    currentPlayer = null;
  }
  if (currentUri) {
    cleanupUri(currentUri);
    currentUri = null;
  }
}

/** Convert a BLOB (ArrayBuffer) to a playable URI. */
async function blobToUri(audioData: ArrayBuffer): Promise<string> {
  if (Platform.OS === "web") {
    const blob = new Blob([audioData], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  }

  // Native: write to temp file
  const FileSystem = require("expo-file-system/legacy");
  const base64 = arrayBufferToBase64(audioData);
  const tempPath = `${FileSystem.cacheDirectory}audio-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(tempPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return tempPath;
}

/** Clean up temporary URI resources. */
function cleanupUri(uri: string): void {
  if (Platform.OS === "web" && uri.startsWith("blob:")) {
    URL.revokeObjectURL(uri);
  } else if (Platform.OS !== "web") {
    const FileSystem = require("expo-file-system/legacy");
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
