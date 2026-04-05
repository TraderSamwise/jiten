import type { BackgroundDownloadItem } from "@/db/dict-download";

export interface DownloadDebugState {
  dictVersion: string | null;
  dictFormat: string | null;
  fullDict: boolean;
  audioVersion: string | null;
  extendedVersion: string | null;
  strokesVersion: string | null;
}

export interface DownloadedDataDebugInput {
  isDownloaded: boolean;
  dictLoaded: boolean;
  audioLoaded: boolean;
  extendedLoaded: boolean;
  strokesLoaded: boolean;
  optionalDataSource: {
    audio: "manifest" | "local" | null;
    strokes: "manifest" | "local" | null;
    extended: "manifest" | "local" | null;
  };
  downloadDebug: DownloadDebugState;
  backgroundStatus: BackgroundDownloadItem[];
}

export function formatDownloadedDataDebugLines(input: DownloadedDataDebugInput): string[] {
  const lines = [
    `Dict: ${input.isDownloaded ? "yes" : "no"} / loaded: ${input.dictLoaded ? "yes" : "no"} / version: ${input.downloadDebug.dictVersion ?? "-"} / format: ${input.downloadDebug.dictFormat ?? "-"}`,
    `Full dict: ${input.downloadDebug.fullDict ? "yes" : "no"}`,
    `Audio: ${input.downloadDebug.audioVersion ? `yes (v${input.downloadDebug.audioVersion})` : "no"} / loaded: ${input.audioLoaded ? "yes" : "no"} / source: ${input.optionalDataSource.audio ?? "-"}`,
    `Extended: ${input.downloadDebug.extendedVersion ? `yes (v${input.downloadDebug.extendedVersion})` : "no"} / loaded: ${input.extendedLoaded ? "yes" : "no"} / source: ${input.optionalDataSource.extended ?? "-"}`,
    `Strokes: ${input.downloadDebug.strokesVersion ? `yes (v${input.downloadDebug.strokesVersion})` : "no"} / loaded: ${input.strokesLoaded ? "yes" : "no"} / source: ${input.optionalDataSource.strokes ?? "-"}`,
  ];

  if (input.backgroundStatus.length > 0) {
    lines.push(
      `Jobs: ${input.backgroundStatus.map((item) => `${item.key}:${item.state}`).join(" | ")}`,
    );
  }

  return lines;
}
