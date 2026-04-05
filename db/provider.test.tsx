/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenDictDb = { name: "dict-db" };
const mockAudioDb = { name: "audio-db" };
const mockStrokesDb = { name: "strokes-db" };
const mockExtendedDb = { name: "extended-db" };

const dictDownloadMocks = vi.hoisted(() => ({
  isDictReady: vi.fn(),
  isAudioReady: vi.fn(),
  hasInstalledAudioDb: vi.fn(),
  isDictFull: vi.fn(),
  setDictFull: vi.fn(),
  clearDictFull: vi.fn(),
  fetchManifest: vi.fn(),
  downloadDictionary: vi.fn(),
  downloadFullDictionary: vi.fn(),
  downloadAudio: vi.fn(),
  checkForUpdate: vi.fn(),
  getStoredDictVersion: vi.fn(),
  setLocalVersion: vi.fn(),
  determineUpdateAction: vi.fn(),
  loadWebDictDb: vi.fn(),
  loadWebAudioDb: vi.fn(),
  storeDbBytes: vi.fn(),
  isStrokesReady: vi.fn(),
  hasInstalledStrokesDb: vi.fn(),
  downloadStrokesDb: vi.fn(),
  setStrokesVersion: vi.fn(),
  openStrokesDb: vi.fn(),
}));

const extendedDownloadMocks = vi.hoisted(() => ({
  isExtendedReady: vi.fn(),
  hasInstalledExtendedDb: vi.fn(),
  downloadExtendedDb: vi.fn(),
  setExtendedVersion: vi.fn(),
}));

const extendedDbMocks = vi.hoisted(() => ({
  openExtendedDb: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: "web" },
  };
});

vi.mock("./dict-download", () => dictDownloadMocks);
vi.mock("./extended-download", () => extendedDownloadMocks);
vi.mock("./extended-db", () => extendedDbMocks);
vi.mock("./dict-client-migrations", () => ({
  runClientDictMigrations: vi.fn(),
}));
vi.mock("@/lib/native-guard", () => ({
  isNativeModuleAvailable: vi.fn(() => false),
}));

import { DatabaseProvider, useDatabase } from "./provider";

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DatabaseProvider>{children}</DatabaseProvider>;
  };
}

describe("DatabaseProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dictDownloadMocks.isDictReady.mockResolvedValue(true);
    dictDownloadMocks.fetchManifest.mockRejectedValue(new Error("server unavailable"));
    dictDownloadMocks.checkForUpdate.mockResolvedValue(false);
    dictDownloadMocks.loadWebDictDb.mockResolvedValue(mockOpenDictDb);
    dictDownloadMocks.loadWebAudioDb.mockResolvedValue(mockAudioDb);
    dictDownloadMocks.hasInstalledAudioDb.mockResolvedValue(true);
    dictDownloadMocks.hasInstalledStrokesDb.mockResolvedValue(true);
    extendedDownloadMocks.hasInstalledExtendedDb.mockResolvedValue(true);
    dictDownloadMocks.openStrokesDb.mockResolvedValue(mockStrokesDb);
    extendedDbMocks.openExtendedDb.mockResolvedValue(mockExtendedDb);
  });

  it("opens locally installed optional DBs when manifest fetch fails", async () => {
    const { result } = renderHook(() => useDatabase(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
      expect(result.current.isDownloaded).toBe(true);
      expect(result.current.dictDb).toBe(mockOpenDictDb);
      expect(result.current.audioDb).toBe(mockAudioDb);
      expect(result.current.strokesDb).toBe(mockStrokesDb);
      expect(result.current.extendedDb).toBe(mockExtendedDb);
    });

    expect(result.current.optionalDataSource).toEqual({
      audio: "local",
      strokes: "local",
      extended: "local",
    });
    expect(result.current.backgroundStatus).toEqual([
      expect.objectContaining({ key: "audio", state: "ready" }),
      expect.objectContaining({ key: "strokes", state: "ready" }),
      expect.objectContaining({ key: "extended", state: "ready" }),
    ]);
    expect(dictDownloadMocks.fetchManifest).toHaveBeenCalledOnce();
    expect(dictDownloadMocks.hasInstalledAudioDb).toHaveBeenCalledOnce();
    expect(dictDownloadMocks.hasInstalledStrokesDb).toHaveBeenCalledOnce();
    expect(extendedDownloadMocks.hasInstalledExtendedDb).toHaveBeenCalledOnce();
  });

  it("reports optional DB open failures without blocking base dictionary startup", async () => {
    dictDownloadMocks.loadWebAudioDb.mockRejectedValue(new Error("audio failed"));
    dictDownloadMocks.openStrokesDb.mockRejectedValue(new Error("strokes failed"));
    extendedDbMocks.openExtendedDb.mockRejectedValue(new Error("extended failed"));

    const { result } = renderHook(() => useDatabase(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
      expect(result.current.isDownloaded).toBe(true);
      expect(result.current.dictDb).toBe(mockOpenDictDb);
    });

    expect(result.current.audioDb).toBeNull();
    expect(result.current.strokesDb).toBeNull();
    expect(result.current.extendedDb).toBeNull();
    expect(result.current.optionalDataSource).toEqual({
      audio: null,
      strokes: null,
      extended: null,
    });
    expect(result.current.backgroundStatus).toEqual([
      expect.objectContaining({ key: "audio", state: "error" }),
      expect.objectContaining({ key: "strokes", state: "error" }),
      expect.objectContaining({ key: "extended", state: "error" }),
    ]);
  });
});
