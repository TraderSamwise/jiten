import { describe, expect, it } from "vitest";
import { formatDownloadedDataDebugLines } from "./settings-debug";

describe("formatDownloadedDataDebugLines", () => {
  it("formats installed, loaded, source, and background job state", () => {
    expect(
      formatDownloadedDataDebugLines({
        isDownloaded: true,
        dictLoaded: true,
        audioLoaded: true,
        extendedLoaded: true,
        strokesLoaded: false,
        optionalDataSource: {
          audio: "manifest",
          extended: "local",
          strokes: null,
        },
        downloadDebug: {
          dictVersion: "23",
          dictFormat: "23",
          fullDict: true,
          audioVersion: "23",
          extendedVersion: "3",
          strokesVersion: "1",
        },
        backgroundStatus: [
          { key: "audio", label: "Audio", state: "ready", progress: 1 },
          { key: "strokes", label: "Stroke data", state: "error", progress: 0 },
          { key: "extended", label: "Extended data", state: "ready", progress: 1 },
        ],
      }),
    ).toEqual([
      "Dict: yes / loaded: yes / version: 23 / format: 23",
      "Full dict: yes",
      "Audio: yes (v23) / loaded: yes / source: manifest",
      "Extended: yes (v3) / loaded: yes / source: local",
      "Strokes: yes (v1) / loaded: no / source: -",
      "Jobs: audio:ready | strokes:error | extended:ready",
    ]);
  });

  it("omits the jobs line when nothing is running", () => {
    expect(
      formatDownloadedDataDebugLines({
        isDownloaded: false,
        dictLoaded: false,
        audioLoaded: false,
        extendedLoaded: false,
        strokesLoaded: false,
        optionalDataSource: {
          audio: null,
          extended: null,
          strokes: null,
        },
        downloadDebug: {
          dictVersion: null,
          dictFormat: null,
          fullDict: false,
          audioVersion: null,
          extendedVersion: null,
          strokesVersion: null,
        },
        backgroundStatus: [],
      }),
    ).toEqual([
      "Dict: no / loaded: no / version: - / format: -",
      "Full dict: no",
      "Audio: no / loaded: no / source: -",
      "Extended: no / loaded: no / source: -",
      "Strokes: no / loaded: no / source: -",
    ]);
  });
});
